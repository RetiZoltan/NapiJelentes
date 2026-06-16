export const state = {
  appUser:          null,
  userData:         null,
  userRole:         null,
  nevek:            [],
  anyagok:          [],
  reszlegek:        [],
  anyagCsoportok:   [],
  anyagCsoportMap:  {},
  reszlegAnyagMap:  {},
  prevDatum:        null,
  isNamePinned:     false,
  isReszlegPinned:  false,
  isMuszakPinned:   false,
  editingEntryId:   null,
};

export function isMainAdmin()        { return state.userData?.isMainAdmin === true; }
export function hasPerm(perm)        { return isMainAdmin() || state.userRole?.permissions?.[perm] === true; }
export function canSeeAllReports()   { return isMainAdmin() || hasPerm('mindenJelentes'); }
export function canManageUsers()     { return isMainAdmin() || hasPerm('felhasznalokKezelese'); }
