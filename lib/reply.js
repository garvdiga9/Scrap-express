// Public API routes answer the page scripts' fetch() calls with JSON. If a
// form is posted the plain HTML way instead (its script didn't load), the
// visitor gets a simple page with the same message rather than raw JSON.
const firebase = require('./firebase');

const isFormPost = (req) => Boolean(req.is('application/x-www-form-urlencoded'));

function reply(req, res, status, { message, error }) {
  if (!isFormPost(req)) return res.status(status).json(error ? { error } : { message });
  return res.status(status).render('notice', {
    page: 'notice',
    noindex: true,
    title: `${error ? 'Please try again' : 'Thank you'} - Scrap Express`,
    description: 'Scrap Express',
    heading: error ? 'Please try again' : 'Thank you!',
    message: error || message,
    icon: error ? 'icon-phone' : 'icon-check',
    canonicalUrl: `${req.app.locals.siteUrl}/`,
    customer: null,
    loginEnabled: firebase.enabled,
    whatsappChannelUrl: '',
  });
}

module.exports = { reply, isFormPost };
