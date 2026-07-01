export const state = {
  appUser:           null,
  userData:          null,
  userRole:          null,
  nevek:             [],
  anyagok:           [],
  reszlegek:         [],
  anyagCsoportok:    [],
  anyagCsoportMap:   {},
  reszlegAnyagMap:   {},
  nevMetadata:       {},
  muszakVezetokMap:  {},  // { "Vezető neve": ["dolgozó1", "dolgozó2", ...] }
  prevDatum:         null,
  isNamePinned:      false,
  isReszlegPinned:   false,
  isMuszakPinned:    false,
  editingEntryId:    null,
};

export function isMainAdmin()        { return state.userData?.isMainAdmin === true; }
export function hasPerm(perm)        { return isMainAdmin() || state.userRole?.permissions?.[perm] === true; }
export function canSeeAllReports()   { return isMainAdmin() || hasPerm('mindenJelentes'); }
export function canManageUsers()     { return isMainAdmin() || hasPerm('felhasznalokKezelese'); }
export function isMuszakVezeto()     {
  const nev = state.userData?.displayName || '';
  return !isMainAdmin() && hasPerm('muszakVezeto') && !!state.muszakVezetokMap[nev];
}
