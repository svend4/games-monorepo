const INCIDENT_IDS = new Set(["insults", "image-pressure", "hate-speech"]);

const ADULT_LABELS = Object.freeze({
  parent: "a parent or carer",
  teacher: "a teacher",
  counsellor: "a school counsellor",
  relative: "a trusted relative",
  coach: "a coach or youth worker",
  other: "another trusted adult",
});

export const INCIDENTS = Object.freeze({
  insults: Object.freeze({
    label: "Insults or bullying",
    firstStep: "Mute or block the account when it is safe to do so.",
    evidence: "Keep only the messages or screenshots you need. Do not reply just to collect more evidence.",
  }),
  "image-pressure": Object.freeze({
    label: "Pressure about images",
    firstStep: "Do not send another image or pay anyone. You are allowed to stop replying.",
    evidence: "Keep the username, messages and dates without downloading or forwarding the image itself.",
  }),
  "hate-speech": Object.freeze({
    label: "Hate speech or targeted abuse",
    firstStep: "Leave the conversation, mute it or block the account when that is safe.",
    evidence: "Save the account name, date and a small amount of evidence. Avoid reposting the abuse.",
  }),
});

function triState(value) {
  if (value === true || value === "yes") return true;
  if (value === false || value === "no") return false;
  return null;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeDraft(value = {}) {
  const incidentType = INCIDENT_IDS.has(value.incidentType) ? value.incidentType : "";
  const adultRole = Object.hasOwn(ADULT_LABELS, value.adultRole) ? value.adultRole : "";

  return {
    incidentType,
    safeNow: triState(value.safeNow),
    directThreat: triState(value.directThreat),
    knowsLocation: triState(value.knowsLocation),
    repeatedContact: triState(value.repeatedContact),
    imageShared: triState(value.imageShared),
    adultRole,
    adultName: cleanText(value.adultName, 80),
    notes: cleanText(value.notes, 600),
  };
}

export function createPersistableDraft(value = {}) {
  const draft = normalizeDraft(value);

  return {
    incidentType: draft.incidentType,
    safeNow: draft.safeNow,
    directThreat: draft.directThreat,
    knowsLocation: draft.knowsLocation,
    repeatedContact: draft.repeatedContact,
    imageShared: draft.imageShared,
    adultRole: draft.adultRole,
  };
}

export function getTrustedAdultLabel(draft) {
  const normalized = normalizeDraft(draft);
  const role = ADULT_LABELS[normalized.adultRole] || "a trusted adult";
  return normalized.adultName ? `${normalized.adultName} (${role})` : role;
}

export function assessUrgency(value) {
  const draft = normalizeDraft(value);
  const urgentReasons = [];

  if (draft.safeNow === false) urgentReasons.push("you said you are not physically safe right now");
  if (draft.directThreat === true) urgentReasons.push("someone made a direct threat");
  if (draft.knowsLocation === true) urgentReasons.push("the person may know where to find you");

  if (urgentReasons.length > 0) {
    return {
      level: "urgent",
      label: "Get immediate help",
      summary: "Move toward a safer place and involve a nearby adult now.",
      reasons: urgentReasons,
      emergency: true,
    };
  }

  const soonReasons = [];
  if (draft.incidentType === "image-pressure") soonReasons.push("pressure involving images needs adult support");
  if (draft.imageShared === true) soonReasons.push("an image may already have been shared");
  if (draft.repeatedContact === true) soonReasons.push("the contact is repeated");

  if (soonReasons.length > 0) {
    return {
      level: "soon",
      label: "Tell an adult today",
      summary: "You do not have to solve this alone. Bring a trusted adult into the plan today.",
      reasons: soonReasons,
      emergency: false,
    };
  }

  return {
    level: "steady",
    label: "Take a calm next step",
    summary: "Pause the contact, keep a small amount of evidence and talk to a trusted adult.",
    reasons: [],
    emergency: false,
  };
}

export function buildSafetyPlan(value) {
  const draft = normalizeDraft(value);
  const urgency = assessUrgency(draft);
  const incident = INCIDENTS[draft.incidentType] || null;
  const adult = getTrustedAdultLabel(draft);
  const steps = [];

  if (urgency.emergency) {
    steps.push({
      id: "safety",
      title: "Move toward immediate safety",
      detail: "Go to a public or shared place, stay near a safe adult and call your local emergency number if danger is immediate.",
    });
  } else {
    steps.push({
      id: "pause",
      title: "Pause before responding",
      detail: "Put the device down for a moment, breathe slowly and do not argue, bargain or send more material.",
    });
  }

  if (incident) {
    steps.push({ id: "incident", title: incident.label, detail: incident.firstStep });
    steps.push({ id: "evidence", title: "Keep limited evidence", detail: incident.evidence });
  }

  steps.push({
    id: "adult",
    title: `Tell ${adult}`,
    detail: urgency.level === "urgent"
      ? "Show them this plan now and ask them to stay with you while you decide what to do next."
      : "Show them the messages and ask them to help you report, block and decide whether more support is needed.",
  });

  steps.push({
    id: "report",
    title: "Use the platform's safety tools",
    detail: "With your adult, block or mute the account and make a platform report. A report may help, but removal cannot be guaranteed.",
  });

  return { urgency, steps };
}

export function getDraftCompletion(value) {
  const draft = normalizeDraft(value);
  const checks = [
    Boolean(draft.incidentType),
    draft.safeNow !== null,
    draft.directThreat !== null,
    draft.knowsLocation !== null,
    draft.repeatedContact !== null,
    draft.imageShared !== null,
    Boolean(draft.adultRole),
  ];
  const complete = checks.filter(Boolean).length;

  return {
    complete,
    total: checks.length,
    percent: Math.round((complete / checks.length) * 100),
    ready: complete === checks.length,
  };
}
