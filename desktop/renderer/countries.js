// The countries a "pick a country" question offers (renderer/question-kind.js list 'countries'): ISO 3166 codes as fixed data (plus Kosovo), named by the
// browser's own Intl in the person's language, sorted by name. A country is a value, never a word that decides anything. Guarded by test/question-kind.test.js.
export const CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DY DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU HV ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NH NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RH RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UK UM US UY UZ VA VC VD VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
export function countryNames(locale = 'en') {
  let names;
  try { names = new Intl.DisplayNames([locale, 'en'], {type: 'region'}); } catch { names = new Intl.DisplayNames(['en'], {type: 'region'}); }
  return CODES.map(code => names.of(code)).filter(Boolean).sort((a, b) => a.localeCompare(b, locale));
}
