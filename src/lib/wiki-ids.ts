/**
 * Shared identifier patterns for the wiki. Pure module (no imports) so it is
 * safe for both server code and client components.
 */

/** Wiki slug pattern (papers, topics, knowledge) — case-insensitive. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

/** Diagram fence id (```diagram <id>) — short slug, at most 41 chars. */
export const DIAGRAM_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i;

/** Matches the info string of a ```diagram <id> fence inside a paper body. */
export const DIAGRAM_ID_IN_BODY_RE = /```diagram ([a-z0-9][a-z0-9-]{0,40})\s*\n/g;
