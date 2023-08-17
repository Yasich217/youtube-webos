import EventTarget from '@ungap/event-target';
// import { Root as ReactDomRoot } from 'react-dom/client'

// import { render } from '../react-kit';

export class OverlayEventListener extends EventTarget {
  overlay: HTMLElement;
  observer?: MutationObserver;
  root?: any;
  container: MutationObserver;
  isRendererAdded = false;

  constructor() {
    super();

    this.overlay = document.querySelector('.yt-unified-overlay-stage') as HTMLElement;
    this.observer = new MutationObserver(this.onMutationCallback);
    this.container = new MutationObserver(this.onContainerMutationCallback);

    console.log('overlay instance', (this.overlay as any).__instance);

    if (123 !== 123) {
      this.observer.observe(this.overlay, {
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
        childList: true,
      });
    }
  }

  onContainerMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      const targetElement = mutation.target as HTMLElement;

      const isLastSetFocdValue = this.isRendererAdded && mutation.oldValue?.includes('ytlr-animated-overlay--hiding');

      if (isLastSetFocdValue && !targetElement.classList.contains('ytlr-animated-overlay--hiding')) {
        const component = (targetElement as any).__instance;

        console.warn('onFocusOverlay', component);

        this.onFocusOverlay();

        continue;
      }


      if (mutation.oldValue && mutation.oldValue.split(' ').includes('ytlr-animated-overlay--focused') && !targetElement.classList.contains('ytlr-animated-overlay--focused')) {
        const component = (targetElement as any).__instance;

        console.warn('unfocused', component);
        this.onFocusOverlay();
        continue;
      }

      if (mutation.oldValue && !mutation.oldValue.split(' ').includes('ytlr-animated-overlay--focused') && targetElement.classList.contains('ytlr-animated-overlay--focused')) {
        const component = (targetElement as any).__instance;

        console.warn('focused', component);
        this.onFocusOverlay();

        continue;
      }

      console.info('OverlayEventListener.onContainerMutationCallback():');
      // console.log('mutation:', mutation);
      console.log('classlist diff:', mutation.oldValue?.split(' '), (mutation.target as HTMLElement).classList);
      // console.log('oldClassList:', mutation.oldValue?.split(' '));
      // console.log('newClassList:', (mutation.target as HTMLElement).classList);
    }
  }

  onMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      const targetElement = mutation.target as HTMLElement;

      // if (!mutation.oldValue?.includes('yt-unified-overlay-stage--focused') && !mutation.oldValue?.includes('yt-unified-overlay-stage--hidden') && targetElement.classList.contains('yt-unified-overlay-stage--focused')) {
      if (mutation.addedNodes.length > 0 && (mutation.addedNodes[0] as HTMLElement).classList.contains('ytlr-overlay-section-renderer')) {
        // if (mutation.oldValue?.includes('yt-unified-overlay-stage--hidden') && targetElement.classList.contains('yt-unified-overlay-stage--focused')) {
        // like onFocusOverlay
        this.isRendererAdded = true;

        continue;
      }

      const isLastSetFocdValue = this.isRendererAdded && !mutation.oldValue?.includes('yt-unified-overlay-stage--focused') && !mutation.oldValue?.includes('yt-unified-overlay-stage--hidden');

      if (isLastSetFocdValue && targetElement.classList.contains('yt-unified-overlay-stage--focused')) {
        // console.warn('observer container');
        this.container.observe(this.overlay.querySelector('.ytlr-animated-overlay') as HTMLElement, {
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ['class']
        });

        continue;
      }

      const isLastSetFocusedValue = mutation.oldValue?.includes('yt-unified-overlay-stage--focused') && !mutation.oldValue?.includes('yt-unified-overlay-stage--hidden');

      if (isLastSetFocusedValue && targetElement.classList.contains('yt-unified-overlay-stage--hidden')) {
        // like onUnfocusOverlay
        const component = (targetElement as any).__instance;
        console.warn('onUnfocusOverlay', component);

        this.isRendererAdded = false;
        this.onBlurOverlay();

        continue;
      }

      console.warn('OverlayEventListener.onMutationCallback():');
      // console.log('mutation:', mutation);
      console.log('classlist diff:', mutation.oldValue?.split(' '), (mutation.target as HTMLElement).classList);
    }
  }

  onFocusOverlay = () => {
    const reactNode = this.overlay.querySelector('.ytlr-animated-overlay__container') as HTMLElement;

    if (!reactNode) {
      console.error('Not react node');
      throw new Error('dd is udn');
    }

    try {
      // this.root = render(reactNode);

      const parentChanger = this.overlay.querySelector('.ytlr-animated-overlay') as HTMLElement;

      console.log('yt-tv-custom-root added', parentChanger);

      this.container.observe(parentChanger, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['class'],
      });
    } catch (e) {
      console.error('error render', e);
    }
  };

  onBlurOverlay = () => {
    this.container?.disconnect();
    // this.root?.unmount();
    // this.overlay.querySelector('.ytlr-animated-overlay__container')?.remove();
  };
}
