// How the screens talk to the app (app.js plugs both in):
// - `go("Casas", {house, tab})` opens the page of that name in the menu, handing it the params;
// - `report({houses, invites, house})` tells it what is due: the houses of the list (each with `due_soon`), the
//   invites waiting, or one house's page, so the number beside "Avisos" in the menu stays right without a request.
export const nav = { go: (name, params) => {}, report: (what) => {} };
