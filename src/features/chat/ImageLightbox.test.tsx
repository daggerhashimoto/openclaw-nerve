/** Tests for ImageLightbox, the chat image thumbnail. */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageLightbox } from './ImageLightbox';

describe('ImageLightbox', () => {
  it('shows the thumbnail while the image loads', () => {
    render(<ImageLightbox src="/api/chat-media?path=x" alt="sunset.png" />);
    expect(screen.getByRole('img', { name: 'sunset.png' })).toBeInTheDocument();
    expect(screen.queryByText('Image no longer available')).toBeNull();
  });

  it('says the image is no longer available when it cannot be loaded', () => {
    // A gateway-hosted image can expire (the gateway forgets it on restart), so the proxy answers 404.
    render(<ImageLightbox src="/api/chat-media?path=x" alt="sunset.png" />);
    fireEvent.error(screen.getByRole('img', { name: 'sunset.png' }));

    expect(screen.queryByRole('img', { name: 'sunset.png' })).toBeNull();
    const note = screen.getByText('Image no longer available');
    expect(note).toHaveAttribute('title', 'sunset.png');
    expect(note).toHaveClass('text-muted-foreground');
  });

  it('tries again when the image source changes', () => {
    const { rerender } = render(<ImageLightbox src="/a.png" alt="first" />);
    fireEvent.error(screen.getByRole('img', { name: 'first' }));
    expect(screen.getByText('Image no longer available')).toBeInTheDocument();

    rerender(<ImageLightbox src="/b.png" alt="second" />);
    expect(screen.getByRole('img', { name: 'second' })).toBeInTheDocument();
    expect(screen.queryByText('Image no longer available')).toBeNull();
  });
});
