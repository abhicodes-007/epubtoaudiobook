import ePub from "epubjs";

export async function openEpub(file) {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);
  await book.ready;

  const navigation = await book.loaded.navigation;
  const spineItems = book.spine.spineItems || book.spine.items || [];

  const chapters = buildChapterList(book, navigation, spineItems);

  return { book, chapters, title: book.package?.metadata?.title || file.name };
}

function buildChapterList(book, navigation, spineItems) {
  const toc = navigation?.toc || [];
  const chapters = [];

  if (toc.length > 0) {
    flattenToc(toc, chapters, 0, book);
    return chapters;
  }

  spineItems.forEach((item, index) => {
    chapters.push({
      id: item.idref || item.href || String(index),
      href: item.href || item.url,
      label: `Section ${index + 1}`,
      depth: 0,
      index,
    });
  });

  return chapters;
}

function flattenToc(items, out, depth, book) {
  for (const item of items) {
    const href = item.href?.split("#")[0];
    const spineSection = href ? book?.spine?.get(href) : null;
    out.push({
      id: item.id || item.href,
      href: item.href,
      label: item.label?.trim() || "Untitled",
      depth,
      index: spineSection?.index,
      subitems: item.subitems,
    });
    if (item.subitems?.length) {
      flattenToc(item.subitems, out, depth + 1, book);
    }
  }
}

export async function loadChapter(book, chapter) {
  const href = chapter.href?.split("#")[0];
  let section =
    (href && book.spine.get(href)) ??
    (chapter.index != null ? book.spine.get(chapter.index) : null);

  if (!section) {
    throw new Error(`Chapter not found in spine: ${chapter.label || href}`);
  }

  const request = book.load.bind(book);
  await section.load(request);

  const doc = section.document;
  if (!doc) {
    throw new Error("Chapter document failed to load");
  }

  return { section, doc, href: chapter.href };
}
