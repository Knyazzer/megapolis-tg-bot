ALTER TABLE registrations
  ADD COLUMN facecast_watch_minutes INT UNSIGNED NULL AFTER facecast_url,
  ADD COLUMN facecast_total_watch_minutes INT UNSIGNED NULL AFTER facecast_watch_minutes,
  ADD COLUMN facecast_stats_synced_at DATETIME NULL AFTER facecast_total_watch_minutes;
