/**
 * B15-23 (INV-132) -- property context in Conversations (Jess R-C2/R-C3,
 * 2026-11-02). PURE: no I/O, no React, no GHL.
 *
 * The selected thread's contact is read once per selection (the existing
 * ghl.contacts.getOne / ghl-contact read, R-C3) and its property address is
 * shown under the name by the R-C1 rule, through the Contacts helper
 * (contactPropertyAddress) and its wording -- never a copy of either:
 *   - the native address block first (street required), with the qualifier,
 *     because a native value is not confirmed as the property's address;
 *   - else the Property Address field, plain;
 *   - else "The contact has no property address on record."
 * Mailing fields never reach this module: it accepts only the address carriers.
 *
 * STALE RESULTS. A read result is shown only while it belongs to the thread on
 * screen (its contactId equals the selected one); anything else reads as
 * loading, so a late answer for an earlier thread can never label this one.
 */
import {
  contactPropertyAddress, NATIVE_ADDRESS_QUALIFIER, PROPERTY_ADDRESS_LOADING, PROPERTY_ADDRESS_NONE,
  PROPERTY_ADDRESS_UNAVAILABLE, type PropertyAddressContact,
} from "./pipeline-property";

export type ConversationContactRead =
  | { contactId: string; kind: "loading" }
  | { contactId: string; kind: "loaded"; contact: Omit<PropertyAddressContact, "id"> }
  | { contactId: string; kind: "failed"; detail: string };

export type ConversationPropertyLine = {
  kind: "native" | "field" | "none" | "loading" | "unavailable";
  /** The address, or what is known instead. */
  text: string;
  /** The qualifier for a native value; null otherwise. */
  note: string | null;
};

export function conversationPropertyLine(read: ConversationContactRead | null, selectedContactId: string): ConversationPropertyLine {
  if (!read || read.contactId !== selectedContactId || read.kind === "loading") return { kind: "loading", text: PROPERTY_ADDRESS_LOADING, note: null };
  if (read.kind === "failed") return { kind: "unavailable", text: PROPERTY_ADDRESS_UNAVAILABLE, note: null };
  const address = contactPropertyAddress(read.contact);
  if (address.source === "native") return { kind: "native", text: address.text, note: NATIVE_ADDRESS_QUALIFIER };
  if (address.source === "field") return { kind: "field", text: address.text, note: null };
  return { kind: "none", text: PROPERTY_ADDRESS_NONE, note: null };
}
