import type { DocumentContent, ImageContent, MessageContent } from '../../types/ai-content';

type Base64ImageSource = Extract<ImageContent['source'], { type: 'base64' }>;

function getMediaType(dataUrl: string): Base64ImageSource['media_type'] {
  const mediaTypeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
  const mediaType = mediaTypeMatch?.[1];

  if (
    mediaType === 'image/jpeg' ||
    mediaType === 'image/png' ||
    mediaType === 'image/gif' ||
    mediaType === 'image/webp'
  ) {
    return mediaType;
  }

  return 'image/jpeg';
}

export function screenshotToImageContent(screenshot: string): ImageContent | null {
  if (screenshot.startsWith('data:image/')) {
    const base64Data = screenshot.split(',')[1];
    if (!base64Data) return null;

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: getMediaType(screenshot),
        data: base64Data,
      },
    };
  }

  if (screenshot.startsWith('http://') || screenshot.startsWith('https://')) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: screenshot,
      },
    };
  }

  return null;
}

/** Decode the payload of a `data:text/...` URL (base64 or percent-encoded). */
function decodeDataUrlText(dataUrl: string): string | null {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return null;
  const meta = dataUrl.slice('data:'.length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  if (/;base64/i.test(meta)) {
    try {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  try {
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/**
 * Turn a single attachment data URL into the matching content block.
 *
 * The same `string[]` wire format carries images and documents alike; the data
 * URL's media type decides the block. PDFs become base64 `document` blocks and
 * text/markdown is decoded into a plain-text `document` source so both provider
 * clients can read it. Order matters: the PDF and text
 * checks run before the image fallback so non-image data URLs aren't mistaken
 * for images.
 */
export function attachmentToContent(
  attachment: string
): ImageContent | DocumentContent | null {
  if (attachment.startsWith('data:application/pdf')) {
    const base64Data = attachment.split(',')[1];
    if (!base64Data) return null;

    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      },
    };
  }

  if (attachment.startsWith('data:text/')) {
    const text = decodeDataUrlText(attachment);
    if (text === null) return null;

    return {
      type: 'document',
      source: {
        type: 'text',
        media_type: 'text/plain',
        data: text,
      },
    };
  }

  return screenshotToImageContent(attachment);
}

export function buildContentWithAttachments(
  text: string,
  attachments: string[] = []
): MessageContent {
  const blocks = attachments
    .map(attachmentToContent)
    .filter((block): block is ImageContent | DocumentContent => block !== null);

  if (blocks.length === 0) {
    return text;
  }

  // Attachments lead the message so provider clients receive the document/image
  // context before the question.
  return [...blocks, { type: 'text', text }];
}
