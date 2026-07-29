# The service and receivers are referenced only from the merged manifest, so
# R8 has no code path to them and would strip them from a release build.
-keep class expo.modules.traxtracker.TrackingService { *; }
-keep class expo.modules.traxtracker.BootReceiver { *; }
-keep class expo.modules.traxtracker.ClockChangeReceiver { *; }
