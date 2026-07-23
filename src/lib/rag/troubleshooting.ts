import "server-only";

export const CONNECTOR_TROUBLESHOOTING_CONTENT = [
  "Component: socket/socket wire",
  "",
  "Identification:",
  "A socket/socket wire has an opening on both connector ends.",
  "",
  "Common problem:",
  "The learner needs a socket/socket wire but only has a plug/plug wire.",
  "",
  "Unsafe or incorrect action:",
  "The two wires should not be treated as interchangeable. Do not force a plug into another plug or attempt to modify the connectors.",
  "",
  "Approved response:",
  "Check the remaining kit bags for the correct socket/socket wire and compare both connector ends with the parts reference. Ask a facilitator for a replacement or an approved alternative before continuing.",
  "",
  "Escalation:",
  "Only use a substitute connection when it is explicitly shown in the approved curriculum materials. If the correct part cannot be found, pause the build rather than improvising the circuit.",
].join("\n");

export function needsConnectorTroubleshooting(
  question: string,
): boolean {
  const normalized =
    question
      .toLowerCase()
      .replace(
        /[-_/]+/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

  const mentionsConnector =
    /\b(plug|socket|pin|hole|connector|wire)\b/.test(
      normalized,
    );

  const describesProblem =
    /\b(only|missing|need|needs|without|instead|wrong|different|replace|substitute|cannot|can't|dont have|don't have|do not have)\b/.test(
      normalized,
    );

  return (
    mentionsConnector &&
    describesProblem
  );
}
