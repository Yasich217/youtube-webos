// import EventTarget from '@ungap/event-target';
import { SettingButton, TransportControlsInstance, TransportControlsProps, TransportControlsState } from './component-types';
import { render } from '../react-kit';

export class ControlsEventListener extends EventTarget {
  container: HTMLElement;
  button?: HTMLElement;
  observers: {
    controls: MutationObserver;
    container: MutationObserver;
    overlay: {
      container: MutationObserver;
    };
  };

  overlay: {
    container?: HTMLElement;
  }

  constructor() {
    super();

    this.overlay = {};

    const container = document.querySelector(".ytlr-transport-controls-renderer");

    if (!container) {
      throw new Error("video element not found");
    }

    this.container = container as HTMLElement;

    this.observers = {
      controls: new MutationObserver(this.onControlsMutationCallback),
      container: new MutationObserver(this.onContainerMutationCallback),
      overlay: {
        container: new MutationObserver(this.onOverlayContainerMutationCallback),
      }
    };

    this.observers.container.observe(this.container, {
      // attributeFilter: ['class'],
      attributeOldValue: true,
      attributes: true,
    });

    // console.log('ControlsEventListener ready');

    this.dispatchEvent(new Event('ready'));
  };

  onKeydownToFocus = () => { }

  mount = () => {

  }

  cb = (e: any) => {
    console.warn('keydown', e);
  }

  onContainerMutationCallback: MutationCallback = (mutations) => {
    for (const mutation of mutations) {
      const targetElement = mutation.target as HTMLElement;

      /** Значит панель становится видимой. */
      if (mutation.oldValue?.includes('zylon-hidden') && !targetElement.classList.contains('zylon-hidden')) {
        // const node = this.container.children[0]?.querySelector('[aria-label="Channel"]')?.cloneNode(true) as HTMLElement;
        // node.ariaLabel = 'SponsorBlock';
        // this.button = node;
        // node && this.container.children[0]?.appendChild(node);

        // this.observers.controls.observe(this.container.children[0], {
        //   childList: true,
        // });

        // console.warn('add button and watch changes');
        // console.log((mutation.target as any).__instance);

        const allBtns = (mutation.target as HTMLElement & TransportControlsInstance).__instance.props.data.buttons;
        const btns = (mutation.target as HTMLElement & TransportControlsInstance).__instance.state.primaryButtons;

        // console.log('allBtns', allBtns);
        // console.log('btns', btns);

        const sponsorblockButtonId = 'sponsorblockButton';

        if (!btns.find(btn => btn.idomKey === sponsorblockButtonId)) {

          const settingsButton = allBtns.find(e => e.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS') as SettingButton;

          if (settingsButton) {
            btns.push({
              idomKey: sponsorblockButtonId,
              renderer: {
                buttonRenderer: {
                  ...settingsButton.button.buttonRenderer,
                  icon: {
                    iconType: 'AUDIOTRACK'
                  },
                  text: {
                    runs: [{
                      text: 'SponsorBlock'
                    }]
                  },
                  trackingParams: 'sponsor-block-control-button',
                  command: {
                    clickTrackingParams: 'sponsor-block-control-button-params',
                    openClientOverlayAction: {
                      // type: 'CLIENT_OVERLAY_TYPE_AUDIO_OPTIONS'
                      // type: 'CLIENT_OVERLAY_TYPE_PLAYBACK_SETTINGS'
                      type: 'CLIENT_OVERLAY_TYPE_ADD_TO_PLAYLIST',
                    }
                  }
                },
              }
            });
          }
        }
      }

      /** Значит панель скрывается. */
      if (targetElement.classList.contains('zylon-hidden') && !mutation.oldValue?.includes('zylon-hidden')) {
        // document.removeEventListener('keydown', this.cb);
        // console.warn('remove button and disconnect');
        // this.button && this.container.children[0]?.removeChild(this.button);
        // this.observers.controls.disconnect();
      }

      // console.warn('onContainerMutationCallback.onMutationCallback():');
      // console.log('mutation:', (mutation.target as any).__instance.props.data.buttons);
      // console.log('mutation:', mutation);

      // const targetCloneElement = this.controls.firstChild?.childNodes[1];

      // const node = targetCloneElement?.cloneNode();

      // targetCloneElement?.childNodes.forEach(child => {
      //   if (child.hasChildNodes()) {
      //     child.childNodes.forEach(subChild => {
      //       child.appendChild(subChild);
      //     });
      //   }
      //   node?.appendChild(child);
      // });
    }
  };

  onControlsMutationCallback: MutationCallback = (mutations) => {
    // return;
    for (const mutation of mutations) {

      // console.log('ControlsEventListener.onControlsMutationCallback(): mutation:', mutation.removedNodes, mutation.addedNodes);

      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.button) {
            this.observers.controls.disconnect();
            console.info('return button');

            const node = this.container.children[0]?.querySelector('[aria-label="Channel"]')?.cloneNode(true) as HTMLElement;
            node.ariaLabel = 'SponsorBlock';

            this.button = node;
            this.container.children[0].appendChild(this.button);

            this.observers.controls.observe(this.container.children[0], {
              childList: true,
            });
          }
        }
      }
    }
  };

  onOverlayContainerMutationCallback: MutationCallback = (mutations) => {
    // return;
    for (const mutation of mutations) {

      // console.log('ControlsEventListener.onOverlayContainerMutationCallback(): mutation:', mutation.removedNodes, mutation.addedNodes);

      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node === this.button) {
            this.observers.controls.disconnect();
            console.info('return button');

            const node = this.container.children[0]?.querySelector('[aria-label="Channel"]')?.cloneNode(true) as HTMLElement;
            node.ariaLabel = 'SponsorBlock';

            this.button = node;
            this.container.children[0].appendChild(this.button);

            this.observers.controls.observe(this.container.children[0], {
              childList: true,
            });
          }
        }
      }
    }
  };
};
