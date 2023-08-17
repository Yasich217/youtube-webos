// import { configRead, configWrite } from './config.js';

/*
`
<h1>webOS YouTube Extended</h1>
<label for="__adblock"><input type="checkbox" id="__adblock" /> Enable AdBlocking</label>
<label for="__sponsorblock"><input type="checkbox" id="__sponsorblock" /> Enable SponsorBlock</label>
<blockquote>
<label for="__sponsorblock_sponsor"><input type="checkbox" id="__sponsorblock_sponsor" /> Skip Sponsor Segments</label>
<label for="__sponsorblock_intro"><input type="checkbox" id="__sponsorblock_intro" /> Skip Intro Segments</label>
<label for="__sponsorblock_outro"><input type="checkbox" id="__sponsorblock_outro" /> Skip Outro Segments</label>
<label for="__sponsorblock_interaction"><input type="checkbox" id="__sponsorblock_interaction" /> Skip Interaction Reminder Segments</label>
<label for="__sponsorblock_selfpromo"><input type="checkbox" id="__sponsorblock_selfpromo" /> Skip Self Promotion Segments</label>
<label for="__sponsorblock_music_offtopic"><input type="checkbox" id="__sponsorblock_music_offtopic" /> Skip Music and Off-topic Segments</label>
</blockquote>
<div><small>Sponsor segments skipping - https://sponsor.ajay.app</small></div>
`;

uiContainer.querySelector('#__adblock').checked = configRead('enableAdBlock');
uiContainer.querySelector('#__adblock').addEventListener('change', (evt) => {
  configWrite('enableAdBlock', evt.target.checked);
});

uiContainer.querySelector('#__sponsorblock').checked =
  configRead('enableSponsorBlock');
uiContainer
  .querySelector('#__sponsorblock')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlock', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_sponsor').checked = configRead(
  'enableSponsorBlockSponsor'
);
uiContainer
  .querySelector('#__sponsorblock_sponsor')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockSponsor', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_intro').checked = configRead(
  'enableSponsorBlockIntro'
);
uiContainer
  .querySelector('#__sponsorblock_intro')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockIntro', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_outro').checked = configRead(
  'enableSponsorBlockOutro'
);
uiContainer
  .querySelector('#__sponsorblock_outro')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockOutro', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_interaction').checked = configRead(
  'enableSponsorBlockInteraction'
);
uiContainer
  .querySelector('#__sponsorblock_interaction')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockInteraction', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_selfpromo').checked = configRead(
  'enableSponsorBlockSelfPromo'
);
uiContainer
  .querySelector('#__sponsorblock_selfpromo')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockSelfPromo', evt.target.checked);
  });

uiContainer.querySelector('#__sponsorblock_music_offtopic').checked =
  configRead('enableSponsorBlockMusicOfftopic');
uiContainer
  .querySelector('#__sponsorblock_music_offtopic')
  .addEventListener('change', (evt) => {
    configWrite('enableSponsorBlockMusicOfftopic', evt.target.checked);
  });

*/

export const showNotification = window.sendUiNotifyMessage

// setTimeout(() => {
//   showNotification('Press [ctrl+s] to open YTAF configuration screen');
// }, 2000);
