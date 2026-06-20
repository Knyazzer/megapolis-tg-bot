ALTER TABLE broadcast_campaigns
  MODIFY content_type ENUM('text','video_note','photo','video') NOT NULL DEFAULT 'text';
