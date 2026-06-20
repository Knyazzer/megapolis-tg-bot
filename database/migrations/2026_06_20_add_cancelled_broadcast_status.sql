ALTER TABLE broadcast_campaigns
  MODIFY status ENUM('draft','queued','sending','sent','failed','cancelled') NOT NULL DEFAULT 'queued';

ALTER TABLE broadcast_messages
  MODIFY status ENUM('queued','sent','failed','cancelled') NOT NULL DEFAULT 'queued';
