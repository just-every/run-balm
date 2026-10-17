# Synthetic migration fixtures

All records are invented. Contact addresses use `.example`; phone numbers use the fictional 555 range. Never email fixture contacts.

Each provider directory contains two patients, three booked appointments (two overlapping on the 2nd of the month after next, one on the 1st of the month after that; the test fills `{{MONTH1}}` and `{{MONTH2}}` from today's date so they stay upcoming), one multiline historical text note, $125.50 and $40.00 opening balances, and two insurance policies. Patient IDs are `cli-1001`, `web-1001`, `sim-1001` or `jan-1001` and the corresponding `1002`.

Cliniko patients use the supported native-header subset. All other per-provider CSVs are explicit Balm conversion templates, not captured or claimed native provider exports. See [format evidence and conversion limits](../../../docs/MOVE-IN-FORMATS.md).

The separate SimplePractice Client details report uses documented report labels with invented data. Its IDs are derived for review; related mapped files in the provider folder use explicit IDs and are a separate bundle. The invalid fixtures demonstrate diagnostics and must not apply successfully.
