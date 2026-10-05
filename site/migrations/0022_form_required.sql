-- Required questions on the forms filled per board and day (the CV and consents aside): the denominator of the real-use rates on
-- /smart-form-filling (unread or answered-by-you questions per 100 required). 0 from apps older than 0.8.96.
ALTER TABLE form_exposure ADD COLUMN required INTEGER NOT NULL DEFAULT 0;
