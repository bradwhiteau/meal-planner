// Google OAuth Web client ID for Drive sync. A client ID is public by design (it is not a secret);
// it only works from the authorised origin https://bradwhiteau.github.io. Leave empty to turn Drive sync off.
// authServer: the sign-in helper on Ecto-Server (server/SETUP.md), so phones stay signed in. Leave empty to use Google's popup.
// If it changes, add the new address to connect-src in index.html too (a test checks this).
window.MP_CONFIG = { googleClientId: '99004060688-hr3dkecj5kh9gqh6gghkb5r6tqk8adpd.apps.googleusercontent.com', authServer: 'https://meals.feralservers.au' };
