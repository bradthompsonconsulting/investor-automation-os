/**
 * Pipeline property context -- B15-09 (INV-108), Walkthrough 2: "Property /
 * Opportunity showed a deal name without property address. Add
 * authoritative address."
 *
 * Pure. No I/O, no React, no GHL.
 *
 * WHAT IS SHOWN, AND WHAT IT IS NOT (Bones review of 9542868):
 *
 * - The value is the contact's own Property Address custom field
 *   (contact.property_address), from the existing contacts read. It is a
 *   CONTACT field: no authorized read associates a property with an
 *   opportunity, and one seller may have several properties or deals
 *   (PB-D55). So the value is always labelled as the contact's field and not
 *   confirmed for this deal, and a contact with more than one deal in the
 *   pipeline says so.
 *
 * - An empty field is reported as exactly that -- the contact's Property
 *   Address field is empty -- never as "no property address". The PropStream
 *   importer puts the property's address in the contact's native address
 *   fields and leaves this custom field blank, so an empty field does not
 *   mean the property is unknown. Those native fields are NOT used here:
 *   whether they may stand in for the property address is an open ruling,
 *   and the index below accepts only `id` and `propertyAddress`, so neither
 *   they nor any mailing address can reach a Pipeline row.
 *
 * - A contacts read that failed, or a contact the list did not return (the
 *   list endpoint can lag), says the address couldn't be loaded.
 */

export const PROPERTY_ADDRESS_UNAVAILABLE = "Property address couldn't be loaded.";
export const PROPERTY_ADDRESS_LOADING = "Loading address…";
export const PROPERTY_NOT_VERIFIED = "Property not verified for this deal";
export const PROPERTY_FIELD_NOTE = "From the contact's Property Address field, not confirmed for this deal";
export const PROPERTY_FIELD_EMPTY = "The contact's Property Address field is empty.";
export const NO_CONTACT_ON_DEAL = "No contact is linked to this deal.";

/** Only these two contact fields are accepted; no other address can be passed in. */
export type PropertyAddressContact = { id: string; propertyAddress: string };

export type PropertyAddressSource =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; byContactId: ReadonlyMap<string, string> };

export type PipelinePropertyCell = {
  kind: "contact_field" | "field_empty" | "no_contact" | "unavailable" | "loading";
  /** The main line: the field's value, or what is known instead. */
  text: string;
  /** Where the value came from and what it does not establish; null when nothing to add. */
  note: string | null;
};

export function indexPropertyAddresses(contacts: readonly PropertyAddressContact[]): Map<string, string> {
  const byContactId = new Map<string, string>();
  for (const c of contacts) {
    if (c.id) byContactId.set(c.id, (c.propertyAddress ?? "").trim());
  }
  return byContactId;
}

/** How many pipeline opportunities each contact has. */
export function countDealsByContact(opportunities: readonly { contactId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of opportunities) {
    if (o.contactId) counts.set(o.contactId, (counts.get(o.contactId) ?? 0) + 1);
  }
  return counts;
}

export function pipelinePropertyCell(contactId: string, dealsForContact: number, source: PropertyAddressSource): PipelinePropertyCell {
  if (!contactId) return { kind: "no_contact", text: PROPERTY_NOT_VERIFIED, note: NO_CONTACT_ON_DEAL };
  if (source.kind === "loading") return { kind: "loading", text: PROPERTY_ADDRESS_LOADING, note: null };
  if (source.kind === "failed") return { kind: "unavailable", text: PROPERTY_ADDRESS_UNAVAILABLE, note: null };
  const address = source.byContactId.get(contactId);
  if (address === undefined) return { kind: "unavailable", text: PROPERTY_ADDRESS_UNAVAILABLE, note: null };
  if (!address) return { kind: "field_empty", text: PROPERTY_NOT_VERIFIED, note: PROPERTY_FIELD_EMPTY };
  const note = dealsForContact > 1
    ? `${PROPERTY_FIELD_NOTE}: this contact has ${dealsForContact} deals in the pipeline`
    : PROPERTY_FIELD_NOTE;
  return { kind: "contact_field", text: address, note };
}
