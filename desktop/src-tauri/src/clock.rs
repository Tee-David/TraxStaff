//! Tamper-resistant timing.
//!
//! Credited work time must not move when the user changes the system clock, and
//! must not accrue while the machine is asleep. Neither `SystemTime` nor
//! `std::time::Instant` gives us both on Windows:
//!
//! - `SystemTime` is the wall clock — the user can set it to anything.
//! - `Instant` maps to `QueryPerformanceCounter`, which Microsoft documents as
//!   *including* time spent in sleep/hibernate/connected-standby. On Linux
//!   `CLOCK_MONOTONIC` excludes it. Same code, opposite behaviour — a closed
//!   laptop would bank hours on Windows and nothing on Linux
//!   (rust-lang/rust#79462).
//!
//! So we sample two counters and derive a third value:
//!
//! | reading  | Windows                              | Linux             |
//! |----------|--------------------------------------|-------------------|
//! | `awake`  | `QueryUnbiasedInterruptTimePrecise`  | `CLOCK_MONOTONIC` |
//! | `uptime` | `QueryInterruptTimePrecise`          | `CLOCK_BOOTTIME`  |
//!
//! `awake` excludes suspended time and is documented as "not subject to
//! adjustments by users or the Windows time service" — it is the only value we
//! ever credit as work. `uptime - awake` is time asleep. Comparing the wall
//! clock's movement against `uptime` reveals whether the clock was changed:
//! that difference is recorded as a tamper signal, never used to compute time.
//!
//! Nothing here trusts the wall clock for duration. Wall-clock timestamps are
//! carried alongside purely as human-readable labels.

use std::time::{SystemTime, UNIX_EPOCH};

/// A single sample of all three clocks, taken as close together as possible.
#[derive(Debug, Clone, Copy)]
pub struct ClockSample {
    /// Nanoseconds of *awake* time since boot. Excludes sleep. Immune to
    /// wall-clock changes. This is the only source for credited duration.
    pub awake_ns: u64,
    /// Nanoseconds since boot *including* sleep. Also immune to wall-clock
    /// changes. Used only to derive suspended time and to detect skew.
    pub uptime_ns: u64,
    /// Wall-clock milliseconds since the Unix epoch. A label, and the input to
    /// skew detection — never a duration.
    pub wall_ms: i64,
}

/// The difference between two [`ClockSample`]s.
#[derive(Debug, Clone, Copy, Default)]
pub struct ClockDelta {
    /// Awake nanoseconds elapsed. **This is the credited work time.**
    pub credited_ns: u64,
    /// Nanoseconds the machine spent suspended between the two samples.
    pub suspended_ns: u64,
    /// How far the wall clock moved *relative to* the monotonic counter.
    /// Approximately zero in normal operation. A large magnitude means the
    /// system clock was changed (or stepped by NTP after a long offline period).
    /// Positive = clock jumped forward, negative = jumped backward.
    pub clock_skew_ns: i64,
}

impl ClockSample {
    pub fn now() -> Self {
        Self {
            awake_ns: awake_ns(),
            uptime_ns: uptime_ns(),
            wall_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        }
    }

    /// Difference from an earlier sample. Saturating throughout: a monotonic
    /// counter that appears to go backwards (VM migration, platform bug) yields
    /// zero credited time rather than a wrapped, enormous one.
    pub fn since(&self, earlier: &ClockSample) -> ClockDelta {
        let credited_ns = self.awake_ns.saturating_sub(earlier.awake_ns);
        let uptime_delta = self.uptime_ns.saturating_sub(earlier.uptime_ns);
        // Awake time can never exceed total uptime; if it appears to, the
        // difference is noise between the two reads, not real sleep.
        let suspended_ns = uptime_delta.saturating_sub(credited_ns);
        let wall_delta_ns = (self.wall_ms - earlier.wall_ms).saturating_mul(1_000_000);
        ClockDelta {
            credited_ns,
            suspended_ns,
            clock_skew_ns: wall_delta_ns.saturating_sub(uptime_delta as i64),
        }
    }
}

impl ClockDelta {
    pub fn credited_secs(&self) -> u64 {
        self.credited_ns / 1_000_000_000
    }
    pub fn suspended_secs(&self) -> u64 {
        self.suspended_ns / 1_000_000_000
    }
    pub fn clock_skew_secs(&self) -> i64 {
        self.clock_skew_ns / 1_000_000_000
    }
    /// Whether the wall clock moved far enough out of step with the monotonic
    /// counter to be worth flagging for human review. The threshold is
    /// deliberately generous: a genuine NTP step after a long offline period can
    /// be several seconds, and we would rather miss a tiny manipulation (which
    /// buys nothing, since duration comes from `credited_ns`) than accuse
    /// someone whose laptop merely resynced.
    pub fn is_clock_suspicious(&self) -> bool {
        self.clock_skew_ns.abs() > 5_000_000_000 // 5s
    }
}

#[cfg(windows)]
mod imp {
    // Both APIs are documented as immune to user/NTP clock adjustment.
    // The `Precise` variants read the hardware directly rather than the last
    // timer tick, so they don't quantise to the ~15.6ms scheduler interval.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn QueryUnbiasedInterruptTimePrecise(lpUnbiasedInterruptTime: *mut u64);
        fn QueryInterruptTimePrecise(lpInterruptTime: *mut u64);
    }

    /// Awake-only time since boot. Excludes sleep/hibernate/connected-standby.
    pub fn awake_ns() -> u64 {
        let mut t: u64 = 0;
        // SAFETY: writes a single u64 we own; the API cannot fail.
        unsafe { QueryUnbiasedInterruptTimePrecise(&mut t) };
        t * 100 // interrupt time is in 100ns units
    }

    /// Time since boot *including* sleep.
    pub fn uptime_ns() -> u64 {
        let mut t: u64 = 0;
        // SAFETY: as above.
        unsafe { QueryInterruptTimePrecise(&mut t) };
        t * 100
    }
}

#[cfg(not(windows))]
mod imp {
    use std::time::Instant;

    // On Linux `CLOCK_MONOTONIC` already excludes suspended time, which is the
    // semantic we want for credited work, and `Instant` wraps it. Without libc
    // we can't read CLOCK_BOOTTIME, so uptime falls back to the same source —
    // suspended time then reads as zero rather than wrong. Windows is the
    // platform that ships today; this keeps the crate building elsewhere.
    fn base() -> Instant {
        use std::sync::OnceLock;
        static BASE: OnceLock<Instant> = OnceLock::new();
        *BASE.get_or_init(Instant::now)
    }

    pub fn awake_ns() -> u64 {
        base().elapsed().as_nanos() as u64
    }

    pub fn uptime_ns() -> u64 {
        awake_ns()
    }
}

use imp::{awake_ns, uptime_ns};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credited_time_advances_and_is_not_wall_clock() {
        let a = ClockSample::now();
        std::thread::sleep(std::time::Duration::from_millis(50));
        let b = ClockSample::now();
        let d = b.since(&a);
        assert!(d.credited_ns >= 40_000_000, "credited {}ns", d.credited_ns);
        // A 50ms sleep is not a suspend and not a clock change.
        assert!(!d.is_clock_suspicious(), "skew {}ns", d.clock_skew_ns);
    }

    #[test]
    fn backwards_sample_saturates_to_zero() {
        let a = ClockSample { awake_ns: 1_000, uptime_ns: 1_000, wall_ms: 1_000 };
        let b = ClockSample { awake_ns: 0, uptime_ns: 0, wall_ms: 0 };
        assert_eq!(b.since(&a).credited_ns, 0);
    }

    #[test]
    fn wall_clock_jump_is_flagged_but_credits_nothing() {
        let a = ClockSample { awake_ns: 0, uptime_ns: 0, wall_ms: 0 };
        // Monotonic advanced 1s; wall clock claims an hour passed.
        let b = ClockSample { awake_ns: 1_000_000_000, uptime_ns: 1_000_000_000, wall_ms: 3_600_000 };
        let d = b.since(&a);
        assert_eq!(d.credited_secs(), 1, "only real elapsed time is credited");
        assert!(d.is_clock_suspicious());
        assert!(d.clock_skew_secs() > 3_500);
    }

    #[test]
    fn suspend_is_measured_but_not_credited() {
        let a = ClockSample { awake_ns: 0, uptime_ns: 0, wall_ms: 0 };
        // 10s of uptime, only 2s of it awake — 8s asleep.
        let b = ClockSample { awake_ns: 2_000_000_000, uptime_ns: 10_000_000_000, wall_ms: 10_000 };
        let d = b.since(&a);
        assert_eq!(d.credited_secs(), 2);
        assert_eq!(d.suspended_secs(), 8);
        assert!(!d.is_clock_suspicious(), "sleep is not a clock change");
    }
}
