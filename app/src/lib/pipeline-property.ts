/**
 * Pipeline property context -- B15-09 (INV-108), Walkthrough 2: "Property /
 * Opportunity showed a deal name without property address. Add
 * authoritative address."
 *
 * Pure apart from loadPropertyAddresses, which only sequences a read it is
 * handed. No React, no GHL.
 *
 * WHAT IS SHOWN, AND WHAT IT IS NOT (B15-09a, Jess D3-i ruling 2026-10-31;
 * earlier Bones review of 9542868):
 *
 * - PRIMARY: the contact's native address block (address1 / city / state /
 *   postalCode), from the existing contacts read. It is the contact's
 *   address-identity set -- one contact = one property
 *   (docs/CONTACTS_OPPORTUNITIES_SPEC.md §4.3) -- which the PropStream
 *   importer fills from PropStream's own property columns, and which the
 *   Contact header, Dashboard, Contract workspace and comps hand-off already
 *   show as the property address. It counts only when the street is set: a
 *   city or state alone does not name a property.
 *
 * - FALLBACK: the contact's Property Address custom field
 *   (contact.property_address), used only when the native street is empty.
 *
 * - NEVER: a mailing address. The index below accepts only `id`, the four
 *   native address parts and `propertyAddress`, so no mailing field can
 *   reach a Pipeline row.
 *
 * - Either value is a CONTACT address: no authorized read associates a
 *   property with an opportunity, and one seller may have several properties
 *   or deals (PB-D55). So it is always labelled as the contact's and not
 *   confirmed for this deal, and a contact with more than one deal in the
 *   pipeline says so. A deal-confirmed address (the B15-04 opportunity
 *   fields) is a later slice; those fields are not provisioned in Production.
 *
 * - A contact with neither a native street nor the custom field has no
 *   property address on record, and the row says exactly that -- with the
 *   same deal-count note when the contact has more than one deal.
 *
 * - A contacts read that failed, or a contact the list did not return (the
 *   list endpoint can lag), says the address couldn't be loaded.
 */

export const PROPERTY_ADDRESS_UNAVAILABLE = "Property address couldn't be loaded.";
export const PROPERTY_ADDRESS_LOADING = "Loading address…";
export const PROPERTY_NOT_VERIFIED = "Property not verified for this deal";
export const PROPERTY_ADDRESS_NOTE = "The contact's property address, not confirmed for this deal";
export const PROPERTY_FIELD_NOTE = "From the contact's Property Address field, not confirmed for this deal";
export const PROPERTY_ADDRESS_NONE = "The contact has no property address on record.";
export const NO_CONTACT_ON_DEAL = "No contact is linked to this deal.";

/** Only these contact fields are accepted; no other address can be passed in. */
export type PropertyAddressContact = {
  id: string;
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  propertyAddress: string;
};

/** A contact's two address carriers, each "" when it holds no usable value. */
export type ContactPropertyAddress = {
  /** The native address block on one line, or "" when the street is empty. */
  native: string;
  /** The Property Address custom field, trimmed. */
  field: string;
};

export type PropertyAddressSource =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; byContactId: ReadonlyMap<string, ContactPropertyAddress> };

export type PipelinePropertyCell = {
  kind: "contact_address" | "contact_field" | "no_address" | "no_contact" | "unavailable" | "loading";
  /** The main line: the address, or what is known instead. */
  text: string;
  /** Where the value came from and what it does not establish; null when nothing to add. */
  note: string | null;
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/**
 * The native address block on one line, "street, city, ST zip" (the Contact
 * header's shape), or "" when the street is empty.
 */
export function formatNativeAddress(c: Pick<PropertyAddressContact, "address1" | "city" | "state" | "postalCode">): string {
  const street = clean(c.address1);
  if (!street) return "";
  const stateZip = [clean(c.state), clean(c.postalCode)].filter(Boolean).join(" ");
  return [street, clean(c.city), stateZip].filter(Boolean).join(", ");
}

export function indexPropertyAddresses(contacts: readonly PropertyAddressContact[]): Map<string, ContactPropertyAddress> {
  const byContactId = new Map<string, ContactPropertyAddress>();
  for (const c of contacts) {
    if (c.id) byContactId.set(c.id, { native: formatNativeAddress(c), field: clean(c.propertyAddress) });
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
  const [kind, text, base] = address.native
    ? (["contact_address", address.native, PROPERTY_ADDRESS_NOTE] as const)
    : address.field
      ? (["contact_field", address.field, PROPERTY_FIELD_NOTE] as const)
      : (["no_address", PROPERTY_NOT_VERIFIED, PROPERTY_ADDRESS_NONE] as const);
  // Every loaded contact's row carries the deal count, an address or not (Bones R1 on 09c0300).
  const note = dealsForContact > 1
    ? `${base.replace(/\.$/, "")}: this contact has ${dealsForContact} deals in the pipeline`
    : base;
  return { kind, text, note };
}

/**
 * Runs one contacts read and applies its outcome, unless cancelled first.
 * Returns the cancel function, for a React effect's cleanup: once a newer
 * read starts, a late success OR failure of an older one changes nothing.
 */
export function loadPropertyAddresses(
  read: () => Promise<readonly PropertyAddressContact[]>,
  apply: (source: PropertyAddressSource) => void,
): () => void {
  let current = true;
  apply({ kind: "loading" });
  read().then(
    (contacts) => { if (current) apply({ kind: "loaded", byContactId: indexPropertyAddresses(contacts) }); },
    (e: unknown) => { if (current) apply({ kind: "failed", detail: e instanceof Error ? e.message : String(e) }); },
  );
  return () => { current = false; };
}
