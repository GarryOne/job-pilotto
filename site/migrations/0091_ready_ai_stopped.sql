-- Ready to send (src/ready-ai.js): set when the night's AI was refused (the user's AI limit or the night's cost cap), so the morning says so.
ALTER TABLE ready_batches ADD COLUMN ai_stopped INTEGER NOT NULL DEFAULT 0;
