/**
 * How many messages one conversation keeps in front (C8.10).
 *
 * The limit is enforced when a pin is added and again when a message
 * comes back from the undo (C8.11): a pin that is hidden with its message
 * does not hold a slot, so a fourth pin can be added while the first is
 * in the bin — and the undo must not put four back.
 *
 * The constant lives here rather than in the database layer so the router
 * and the database helper read the same number without either of them
 * importing the other.
 */
export const MAX_MESSAGE_PINS = 3;
