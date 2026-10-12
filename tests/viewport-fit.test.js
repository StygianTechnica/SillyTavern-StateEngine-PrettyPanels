// Keeping panels in the window as it changes size (src/panels/viewport-fit.js).

import { edgesFor, fitToViewport, marginWidths, EDGE_STICK, MIN_CHAT_WIDTH, MIN_COLUMN_SCALE, COLUMN_PADDING } from '../src/panels/viewport-fit.js';
import { pickDesign } from '../src/storage/design.js';

describe('edgesFor', () => {
    it('notices a panel flush against the right or bottom edge', () => {
        expect(edgesFor({ x: 1620, y: 100, width: 300, height: 200 }, 1920, 1080)).toEqual({ stickRight: true, stickBottom: false });
        expect(edgesFor({ x: 1612, y: 870, width: 300, height: 200 }, 1920, 1080)).toEqual({ stickRight: true, stickBottom: true });
        expect(edgesFor({ x: 1600 - EDGE_STICK - 1, y: 0, width: 300, height: 200 }, 1920, 1080).stickRight).toBe(false);
    });

    it('does not stick a panel as wide or tall as the window', () => {
        expect(edgesFor({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080)).toEqual({ stickRight: false, stickBottom: false });
    });
});

describe('fitToViewport', () => {
    it('keeps a right-flush panel against the right edge as the window shrinks and grows', () => {
        const panel = { x: 1620, y: 100, width: 300, height: 200, stickRight: true };
        expect(fitToViewport(panel, 1200, 800)).toEqual({ x: 900, y: 100 });
        expect(fitToViewport(panel, 2560, 1440)).toEqual({ x: 2260, y: 100 });
    });

    it('brings a free panel wholly into a smaller window, and back to its place in a larger one', () => {
        const panel = { x: 1500, y: 900, width: 300, height: 200 };
        expect(fitToViewport(panel, 1200, 800)).toEqual({ x: 900, y: 600 });
        expect(fitToViewport(panel, 1920, 1200)).toEqual({ x: 1500, y: 900 });
    });

    it('keeps the top-left corner of a panel larger than the window on screen', () => {
        expect(fitToViewport({ x: 300, y: 50, width: 1400, height: 300 }, 1000, 800)).toEqual({ x: 0, y: 50 });
    });

    it('sticks to the bottom edge too', () => {
        expect(fitToViewport({ x: 10, y: 880, width: 300, height: 200, stickBottom: true }, 1200, 700)).toEqual({ x: 10, y: 500 });
    });
});

describe('marginWidths', () => {
    it('leaves columns alone while the chat has room', () => {
        expect(marginWidths({ left: 0, right: 300 }, 1920)).toEqual({ left: 0, right: 300, leftScale: 1, rightScale: 1 });
        expect(marginWidths({}, 800)).toEqual({ left: 0, right: 0, leftScale: 1, rightScale: 1 });
    });

    it('shrinks the columns before the chat narrows past its minimum', () => {
        const vw = MIN_CHAT_WIDTH + 2 * COLUMN_PADDING + 300; // room for 300 of the 400 wanted
        const fitted = marginWidths({ left: 100, right: 300 }, vw);
        expect(fitted.leftScale).toBeCloseTo(0.75);
        expect(fitted).toMatchObject({ left: 75, right: 225 });
    });

    it('stops shrinking at the minimum scale', () => {
        const fitted = marginWidths({ right: 400 }, 600);
        expect(fitted).toEqual({ left: 0, right: 400 * MIN_COLUMN_SCALE, leftScale: 1, rightScale: MIN_COLUMN_SCALE });
    });
});

describe('stored edges', () => {
    it('are part of a panel design', () => {
        expect(pickDesign({ stickRight: true })).toMatchObject({ stickRight: true, stickBottom: false });
        expect(pickDesign({ stickRight: 'yes' }).stickRight).toBe(false);
    });
});
