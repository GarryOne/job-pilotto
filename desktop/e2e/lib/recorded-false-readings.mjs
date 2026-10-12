// The false readings the replays found and nobody has fixed yet (lib/replay-truth.mjs againstLedger): case name -> the exact failure lines. Each line is a bug, never a loosened assert;
// a listed line that does not show is said as GONE? in the replay log (some depend on timing): remove it once its fix landed. Lines are only removed, never added to pass a case. Imported (not read by path) so a change to it starts the replays (tools/replay-files.mjs).
export const FALSE_READINGS = {
  // the fill record leaves 7 required, the panel 10 (CV and two more): the record undercounts what is left (found 13 Oct 2026, #531)
  "ashby-open-question-written-1": [
    "agreement: the fill record leaves 7 required (Linkedin, Téléphone, Quelles sont vos motivations pour rejoindre Pennylane ?, Avez-vous le droit de travailler en France ? Nous ne sommes , Êtes-vous capable de travailler en anglais demain ?, Quelle est votre localisation ? (Région seulement), Quelles sont vos attentes salariales ?), the panel 10 (Linkedin, CV, Téléphone, Quelles sont vos motivations pour rejoindre Pennylane ?, Avez-vous le droit de travailler en France ? Nous ne sommes , Êtes-vous capable de travailler en anglais demain ?, Quelle est votre localisation ? (Région seulement), Quelles sont vos attentes salariales ?, Avez-vous le droit de travailler en France ? Nous ne sommes , Êtes-vous capable de travailler en anglais demain ?)",
  ],
};
