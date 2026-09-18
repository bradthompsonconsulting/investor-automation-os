/** Synthetic complete contract facts, derived from the existing authorization-model fixtures. */
exports.contractFixture = function(load, opportunityId, AGREEMENT_AT = '2026-09-12T00:00:00.000Z') {
  const C=load('seller-contract-facts-carriers');
  function fullyPopulatedNotes(opportunityId) {
  return [
    { body: C.formatPartySignerFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', signers: [{ role: 'Seller', displayName: 'Jane Seller', signingAuthorityNote: null }] }) },
    { body: C.formatPropertyLegalDescriptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', lot: { kind: 'value', value: '12' }, block: { kind: 'value', value: 'A' }, addition: { kind: 'value', value: 'Oak Hills' }, county: { kind: 'value', value: 'Travis' }, exclusions: { kind: 'none' }, reservations: { kind: 'none' }, legalMunicipality: { kind: 'municipality', name: 'Round Rock' } }) },
    { body: C.formatLeaseDisclosureFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', residentialLeases: 'none', fixtureLeases: 'none', naturalResourceLeases: { kind: 'none' } }) },
    { body: C.formatEarnestMoneyOptionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', escrowAgentName: 'First Title Co', escrowAgentAddress: '1 Main St, Austin, TX', earnestMoney: { kind: 'amount', amount: 1000 }, optionFee: { kind: 'amount', amount: 200 }, optionPeriodDays: { kind: 'days', days: 10 }, additionalEarnestMoney: { kind: 'none' } }) },
    { body: C.formatTitleSurveyFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', titlePolicyExpenseParty: 'seller', titleCompanyName: 'Austin Title Co', shortageAmendmentElection: { kind: 'amended', expenseParty: 'buyer' }, surveyElection: { option: 'seller_existing_survey', sellerFurnishDays: 10, ifRejectedExpenseParty: 'seller' }, objectionsText: { kind: 'none' }, objectionsDays: 5, poaMembership: 'is_not_subject' }) },
    { body: C.formatPropertyConditionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerDisclosureNotice: { kind: 'received' }, asIsElection: { kind: 'as_is' }, serviceContractCap: { kind: 'none' }, waterDisclosure: { kind: 'exempt', noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: 'City of Austin' } }) },
    { body: C.formatClosingPossessionFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', closingDate: '2026-10-15T00:00:00.000Z', possessionElection: 'upon_closing_and_funding', possessionDetails: { kind: 'none' } }) },
    { body: C.formatSettlementExpenseFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', sellerCreditCap: { kind: 'none' }, sellerPaysBuyerBroker: { kind: 'none' }, buyerPaysSellerBroker: { kind: 'none' } }) },
    { body: C.formatRepresentationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', representation: { kind: 'none' } }) },
    { body: C.formatAddendaApplicabilityFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', items: Object.fromEntries(C.ADDENDA_APPLICABILITY_ITEM_KEYS.map((k) => [k, false])), districtNotices: { kind: 'none' } }) },
    { body: C.formatSellerEquitableInterestDisclosureNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', disposition: { kind: 'made', at: AGREEMENT_AT } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'special_provisions', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatAttorneyManualFieldDispositionNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', slot: 'other_addenda_text', disposition: { kind: 'not_applicable' } }) },
    { body: C.formatSellerNoticeConfirmationFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '123 Main St, Austin, TX, 78701', noticePhone: { kind: 'none' }, noticeEmail: { kind: 'value', value: 'seller@example.com' }, source: 'confirmed_from_contact_record' }) },
    { body: C.formatBuyerBusinessConfigFactsNote({ opportunityId, at: AGREEMENT_AT, operator: 'brad', noticeAddress: '1 Business Rd, Austin, TX', noticePhone: '555-0000', noticeEmail: 'buyer@btcllc.example', signerName: 'Brad Thompson', signerRole: 'Manager' }) },
  ];
}

  const notes=fullyPopulatedNotes(opportunityId);
  notes.push({body:C.formatSellerSigningModelNote({opportunityId,at:AGREEMENT_AT,operator:'brad',model:{kind:'one_seller',seller1Capacity:'individual_own_capacity'}})});
  notes.push({body:load('seller-call-outcome').formatOutcomeNote({opportunityId,at:AGREEMENT_AT,operator:'brad',kind:'accept',reason:null,followUpAt:null,snapshot:{sellerPosition:190000,currentOffer:190000,targetAcquisitionPrice:180000,maxSupportedOffer:200000,expectedSpread:10000,arv:300000,repairs:25000,readinessStatus:'OFFER_READY'}})});
  const version=load('board9-contract-model').initialVersionIdentity(AGREEMENT_AT);
  const report=load('contract-facts-model').computeSellerContractFactsReport({opportunityId,notes,agreedPrice:190000,agreementAt:AGREEMENT_AT,propertyAddress:'123 Main St, Austin, TX, 78701'});
  const preview=load('contract-document-model').buildContractDocumentPreview({opportunityId,version,report,propertyStreetAddress:{kind:'populated',value:'123 Main St, Austin, TX, 78701',authority:'operator_attested',recordedAt:null}});
  const auth=load('contract-authorization-model').buildAuthorizationRecordArgs({opportunityId,at:AGREEMENT_AT,preview,currentVersion:version});
  if(!auth.ok)throw Error('Invalid complete fixture: '+JSON.stringify(auth.reasons));
  return {notes,version,report,preview,authorization:auth.value};
};
