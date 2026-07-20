import { describe, expect, it } from 'vitest';
import { getResponseFileName } from '../src/sidepanel/lib/slides';

describe('slide export filenames', () => {
  it('uses the Lenses response header when the exporter supplies a name', () => {
    const response = new Response('', {
      headers: { 'x-lenses-filename': 'review-slides.html' },
    });

    expect(getResponseFileName(response, 'video-1')).toBe('review-slides.html');
  });

  it('uses a product-named fallback', () => {
    expect(getResponseFileName(new Response(''), 'video-1')).toBe(
      'lenses-slides-video-1.html'
    );
  });
});
