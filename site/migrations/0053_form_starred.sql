-- Labels a filled form marks with a "*", per board and day: counted by the extension WITHOUT its required rule (page/required-mark.js starred()).
-- Beside `required` it is the cross-check: starred far above required means the rule missed a layout (10 Oct 2026, "Anrede*:" on a umantis form read as
-- "No required fields"). A number only, no text. 0 from apps older than 0.9.175.
ALTER TABLE form_exposure ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
