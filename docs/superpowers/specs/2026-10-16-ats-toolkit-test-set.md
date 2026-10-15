# ATS toolkit test set: every control of the big application systems, tested before a person meets it

**Status: PARKED** (owner, 15 Oct 2026: "document, spec, GitHub discussion, and park it for later"). Discussion: https://github.com/GarryOne/job-pilotto/discussions/938

## Why
On 15 Oct 2026 the owner's first real SuccessFactors application showed three bugs on one plain-looking dropdown kind (SAP UI5 `sap.m.Select`):
- the options were read as one glued string ("No SelectionMr.Ms.Diverse"), so no answer could match (Title);
- a pick showed on screen but the page cleared it ("empty again at the end of the fill", Country);
- a value the page shows (picked by us or by the person) was listed as "left for you", because the read-back looks at an empty hidden input, not the visible choice.
None was caught because our tests only reach SuccessFactors and Workday up to their sign-in page: every control behind it was untested. We fix controls site by site, after a site breaks them; real sites are built from a few UI toolkits.

## Goal
For each toolkit the top application systems are built with, one set of test pages built from each control's **documented** structure, each proving three things: **read** (its current value and its options), **set** (our pick), **sticks** (the value is still there after the page settles and after focus leaves).

| Toolkit | Used by | First controls |
|---|---|---|
| SAP UI5 (`sap.m`) | SuccessFactors | Select, ComboBox, MultiComboBox, DatePicker, RadioButtonGroup, CheckBox, upload |
| Workday's own | Workday | its select/prompt widget, multi-select pills, date, radio, "My Information" steps |
| Oracle (JET / Redwood) | Oracle Recruiting / Taleo | select, combobox, date |
| React components | Greenhouse, Ashby, Lever | react-select (single/multi), typeaheads, date pickers |

## How
- Test pages under the widget zoo / recorded pages, built from the toolkit's public docs and real-page markup where we have it (a "Report this form" capture, a recording past sign-in with a test account). Never invented markup presented as real: each page says its source.
- One test per (toolkit, control, verb): read / set / sticks, run on the real extension like the page cases. A new control kind fails until it has all three.
- The read-back (what the panel lists as "left for you") is tested on the same pages: a value the page shows is never listed as left.

## Order (when unparked)
1. SAP UI5 Select/ComboBox (the three 15 Oct bugs; job-pilotto-0c started the read-back part).
2. Workday after sign-in (needs the test accounts: richemont exists; Red Hat, Chanel to create).
3. Oracle, then the React set (partly covered by existing cases: check before adding).

## Depends on
- Test accounts for SuccessFactors and Workday (owner, 15 Oct 2026: approved; Keychain `job-pilotto.test-account.<host>.{email,password}`).
- "Report this form" reaching the app (it failed on 15 Oct: stale extension; #935).

## Progress
### 1. SAP UI5
- [ ] Select: read, set, sticks
- [ ] ComboBox: read, set, sticks
- [ ] the panel's read-back on both
### 2. Workday
- [ ] its select/prompt widget: read, set, sticks
- [ ] multi-select pills
### 3. Oracle
- [ ] select, combobox, date
### 4. React set
- [ ] audit the existing react-select/typeahead cases against read/set/sticks
