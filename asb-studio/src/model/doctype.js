/* ==========================================================================
   model/doctype.js
   --------------------------------------------------------------------------
   What kind of document is this?

   The site publishes two quite different things and build.py treats them
   differently:

     work     a story, essay or magazine piece. Has a title, an author, a
              category, a date, tags, and possibly a price.
     creator  a person's profile page. Has a name, roles, social links, and a
              biography as its body. No title, no date, no category of its own.

   The studio only ever knew the first, which is why a creator profile came up
   covered in warnings about fields it is not supposed to have.

   build.py decides by the folder a file sits in (main/creators/…), falling
   back to the category field. The browser cannot always see the folder, so the
   shape of the frontmatter decides here - and the author can always say
   outright which it is.

   This module must never touch the DOM.
   ========================================================================== */

export const DOC_TYPES = {
  work: 'اثر',
  creator: 'پدیدآورنده',
};

/**
 * Works out the type of a document.
 * @returns {'work'|'creator'}
 */
export function detectType(doc) {
  const fm = doc.frontmatter;

  // Said outright: build.py reads this too and an explicit value always wins.
  if (String(fm.get('category') || '').trim() === 'creators') return 'creator';

  // A profile carries roles or social links and never carries a title.
  if (fm.has('roles') || fm.has('socials')) return 'creator';
  if (fm.has('name') && !fm.has('title')) return 'creator';

  return 'work';
}

/** True when the type was stated in the file rather than worked out. */
export function isTypeExplicit(doc) {
  return String(doc.frontmatter.get('category') || '').trim() === 'creators';
}

/**
 * Writes the type into the file. For a creator this means an explicit
 * `category: creators`, which is what makes build.py take the profile branch
 * no matter which folder the file ends up in.
 */
export function setType(doc, type) {
  if (type === 'creator') doc.frontmatter.set('category', 'creators');
  else if (String(doc.frontmatter.get('category') || '') === 'creators') doc.frontmatter.remove('category');
  return doc;
}
