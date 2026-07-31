// Per-account partitioning of the on-disk offline queue and the local
// screenshot gallery.
//
// Both used to live at a single global `app_data_dir/queue` (plus its sibling
// `shots/`) shared by every account that ever signed in on the install. On a
// shared or reused machine that had two consequences:
//
//   * `local_shots` rendered whatever sat in `shots/` with no ownership check,
//     so a new user's in-app gallery showed the previous user's screenshots.
//   * the flush loop posted the previous user's queued blocks using the NEW
//     user's token. The backend correctly refuses them — a block whose session
//     belongs to someone else answers 404 (see backend routes/sync.ts) — and
//     the client treats 404 as a permanent rejection and deletes the block
//     along with its screenshots. That silently destroyed time the first user
//     had tracked offline and never got to sync.
//
// Everything now lives under `app_data_dir/users/<key>/`, so a queue is only
// ever flushed with the credentials that can actually claim it, and a gallery
// only ever shows its owner's shots. Data belonging to a signed-out account is
// left untouched on disk and drains the next time that account signs in.
//
// The pre-partition dirs are left exactly where they are rather than migrated
// or deleted, because nothing on the client can prove who owns them: the old
// `queue/` is drained opportunistically (each account claims only the blocks
// the server accepts for it, see sync.rs) and the old `shots/` gallery mirror
// is simply never read again. Neither can grow — every new write is scoped.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};

/// Scope key of the signed-in account, or None while signed out.
static CURRENT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Point the queue/gallery at the account `token` belongs to. An empty token
/// (sign-out) clears the scope, which leaves that account's files on disk and
/// makes every dir lookup below return None until someone signs in again.
pub fn set_from_token(token: &str) {
    let key = if token.trim().is_empty() { None } else { key_from_token(token) };
    if let Ok(mut g) = CURRENT.lock() {
        *g = key;
    }
}

/// Scope key of the signed-in account, if any.
pub fn current() -> Option<String> {
    CURRENT.lock().ok().and_then(|g| g.clone())
}

/// Root for one account's data: `<app_data_dir>/users/<key>`.
fn user_root(base: &Path, key: &str) -> PathBuf {
    base.join("users").join(key)
}

/// One account's offline sync queue (block manifests + their shot bytes).
pub fn queue_dir(base: &Path, key: &str) -> PathBuf {
    user_root(base, key).join("queue")
}

/// One account's local screenshot mirror, kept as a sibling of the queue so
/// capture.rs's `shots_dir(queue_dir)` (which walks up one level) resolves here
/// too.
pub fn shots_dir(base: &Path, key: &str) -> PathBuf {
    user_root(base, key).join("shots")
}

/// The pre-partition shared queue. Frozen: nothing writes here any more, and
/// it only ever shrinks as each owner signs in and drains their share.
pub fn legacy_queue_dir(base: &Path) -> PathBuf {
    base.join("queue")
}

/// Derive a scope key from a backend JWT: the first 16 hex chars of SHA-256
/// over its `userId` claim.
///
/// The signature is deliberately NOT verified — there is no secret on the
/// client, and this value only picks a local directory name. A forged token
/// buys nothing, since the server still authenticates every request; the worst
/// case is writing a queue that nothing can ever flush.
///
/// The claim is hashed rather than used raw so an account identifier never
/// lands in a filesystem path that local software and backups can enumerate.
fn key_from_token(token: &str) -> Option<String> {
    // Fall back to the token itself when the payload can't be read, so a
    // surprise token format degrades to "queue is stranded until the format is
    // fixed" rather than "tracking refuses to start". Never falls back to a
    // shared key — that is the bug this module exists to prevent.
    let claim = user_id_claim(token).unwrap_or_else(|| token.to_string());
    let mut h = Sha256::new();
    h.update(claim.as_bytes());
    let digest = h.finalize();
    Some(digest.iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// The `userId` claim out of a JWT's payload segment, unverified.
fn user_id_claim(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    // JWTs are base64url without padding, but tolerate padding rather than
    // silently dropping to the token-hash fallback over a trailing '='.
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let id = v.get("userId")?.as_str()?;
    if id.is_empty() { None } else { Some(id.to_string()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an unsigned JWT-shaped token with the given payload.
    fn token_with(payload: &str) -> String {
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.as_bytes());
        format!("header.{b64}.signature")
    }

    #[test]
    fn reads_the_user_id_claim() {
        let t = token_with(r#"{"userId":"abc-123","orgId":"o1","role":"member"}"#);
        assert_eq!(user_id_claim(&t).as_deref(), Some("abc-123"));
    }

    #[test]
    fn same_account_keeps_one_key_across_token_refreshes() {
        // Different orgId/role/exp, same userId — a refreshed token must not
        // strand the queue the previous token was writing to.
        let a = token_with(r#"{"userId":"abc-123","exp":1}"#);
        let b = token_with(r#"{"userId":"abc-123","exp":999}"#);
        assert_eq!(key_from_token(&a), key_from_token(&b));
    }

    #[test]
    fn different_accounts_never_share_a_key() {
        let a = token_with(r#"{"userId":"user-a"}"#);
        let b = token_with(r#"{"userId":"user-b"}"#);
        assert_ne!(key_from_token(&a), key_from_token(&b));
    }

    #[test]
    fn unreadable_payload_falls_back_to_a_per_token_key() {
        // Not a shared key: two malformed tokens must still land in separate
        // directories rather than pooling into one queue.
        assert_eq!(user_id_claim("not-a-jwt"), None);
        assert_ne!(key_from_token("not-a-jwt"), key_from_token("also-not-a-jwt"));
    }

    #[test]
    fn key_is_a_safe_directory_name() {
        let t = token_with(r#"{"userId":"../../etc/passwd"}"#);
        let key = key_from_token(&t).unwrap();
        assert_eq!(key.len(), 16);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn shots_dir_is_the_queues_sibling() {
        // capture.rs derives the gallery dir from the queue's parent; the two
        // must agree or freshly-captured shots land outside the gallery.
        let base = Path::new("/data");
        let q = queue_dir(base, "k");
        assert_eq!(q.parent().unwrap().join("shots"), shots_dir(base, "k"));
    }
}
