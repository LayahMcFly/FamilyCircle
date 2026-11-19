/* Family Exchange preview: invented people and listings (PREVIEW CODE, sample only).
 * Copyright Leia. Licence for this file: not yet marked; it follows the repository licensing decision, which is still open.
 * Nothing here is a real family. Photos are drawn sample images bundled in ./img (600px or smaller). */
(function () {
  'use strict';
  function ph(file, w, h, alt) { return { id: file, src: 'img/' + file + '.jpg', w: w, h: h, alt: alt }; }
  var PHOTOS = [
    ph('shelf-front', 450, 600, 'Oak bookshelf, front view'), ph('shelf-side', 600, 338, 'Oak bookshelf, wide view'), ph('shelf-detail', 560, 560, 'Oak bookshelf, shelf detail'),
    ph('books-box', 600, 450, 'Box of chapter books'), ph('books-spines', 450, 600, 'Chapter book spines'),
    ph('bike-side', 600, 450, 'Child bike, side view'), ph('bike-wide', 600, 338, 'Child bike, wide view'),
    ph('lamp-full', 450, 600, 'Floor lamp'),
    ph('chair-front', 560, 600, 'Desk chair, front view'), ph('chair-side', 600, 450, 'Desk chair, side view'), ph('chair-base', 600, 600, 'Desk chair, base'),
    ph('blanket-set', 600, 400, 'Folded baby blankets')
  ];
  /* Synthetic account states. "eligible" is a made-up preview flag. It is NOT the production eligibility mechanism, which is undecided. */
  var VIEWERS = [
    { id: 'ava', name: 'Ava Rowan', eligible: true, note: 'eligible adult' },
    { id: 'ben', name: 'Ben Rowan', eligible: true, note: 'eligible adult' },
    { id: 'dana', name: 'Dana Rowan', eligible: true, moderator: true, note: 'eligible adult, simulated Exchange moderator' },
    { id: 'cleo', name: 'Cleo Rowan', eligible: false, note: 'ineligible (account-level restriction)' },
    { id: 'eli', name: 'Eli Rowan', eligible: false, note: 'ineligible (account not classified)' }
  ];
  var LISTINGS = [
    { id: 'l1', kind: 'free', status: 'available', owner: 'ava', title: 'Oak bookshelf', category: 'Furniture', condition: 'Good', area: 'Near the library', ago: '2 days ago',
      description: 'Three-shelf oak bookshelf, about 4 feet tall. A few scuffs on one side. Comes apart with an Allen key, which I can leave in the box.', photos: ['shelf-front', 'shelf-side', 'shelf-detail'] },
    { id: 'l2', kind: 'free', status: 'available', owner: 'ben', title: 'Box of chapter books, ages 8 to 11', category: 'Books and media', condition: 'Good', area: 'North side', ago: '3 days ago',
      description: 'About 30 paperbacks, mostly series. Some have bent corners. Takes two people to carry, the box is heavy.', photos: ['books-box', 'books-spines'] },
    { id: 'l3', kind: 'free', status: 'reserved', owner: 'dana', reservedFor: 'ben', title: '20-inch kids bike', category: 'Sports and toys', condition: 'Worn but usable', area: 'Near the park', ago: '5 days ago',
      description: 'Red bike, tires need air. Training wheels not included.', photos: ['bike-side', 'bike-wide'] },
    { id: 'l4', kind: 'free', status: 'gone', owner: 'ben', title: 'Floor lamp', category: 'Kitchen and home', condition: 'Like new', area: 'Downtown', ago: '2 weeks ago',
      description: 'Plain black floor lamp with a cream shade. Bulb not included.', photos: ['lamp-full'] },
    { id: 'l5', kind: 'free', status: 'available', owner: 'dana', title: 'Desk chair with adjustable height', category: 'Furniture', condition: 'Good', area: 'Near the school', ago: '1 day ago',
      description: 'Blue fabric chair. The height lever works. The seat has a small stain, shown in the base photo.', photos: ['chair-front', 'chair-side', 'chair-base'] },
    { id: 'l6', kind: 'free', status: 'available', owner: 'ava', title: 'Baby blankets, set of four', category: 'Kids and baby', condition: 'Like new', area: '', ago: '6 days ago',
      description: 'Washed and folded. Cotton, in pastel colours.', photos: ['blanket-set'] },
    { id: 'l7', kind: 'free', status: 'reserved', owner: 'dana', reservedFor: 'ben', title: 'SAMPLE FOR TESTING: reserved lantern', category: 'Kitchen and home', condition: 'Good', area: 'Near the park', ago: 'Sample',
      description: 'A pre-reserved sample so you can test private edits and releasing. It is reserved for Ben Rowan, and Ava Rowan has a waiting request. View it as Dana Rowan to edit or release it.', photos: ['lamp-full'] },
    { id: 'w1', kind: 'wanted', status: 'open', owner: 'ben', title: 'Tomato cages', category: 'Garden and outdoor', area: 'North side', ago: '1 day ago',
      description: 'Looking for four or five cages for this spring. Any size is fine, and rust is no problem.', photos: [] },
    { id: 'w2', kind: 'wanted', status: 'open', owner: 'dana', title: 'Folding table for Saturday', category: 'Kitchen and home', area: 'Near the park', ago: '4 days ago',
      description: 'Borrowing is not part of this first version, so only a table someone is ready to give away. Six-foot size would be ideal.', photos: [] },
    { id: 'w3', kind: 'wanted', status: 'fulfilled', owner: 'ava', title: 'Rain boots, kids size 2', category: 'Clothing', area: 'Downtown', ago: '3 weeks ago',
      description: 'Any colour. Gently used is fine.', photos: [] },
    { id: 'd1', kind: 'free', status: 'draft', owner: 'ava', title: 'Mixing bowls', category: 'Kitchen and home', condition: 'Good', area: '', ago: 'Saved yesterday',
      description: 'Set of three, one has a chip on the rim.', photos: [] },
    { id: 'x1', kind: 'free', status: 'withdrawn', owner: 'ben', title: 'Board games', category: 'Sports and toys', condition: 'Good', area: 'North side', ago: '1 week ago',
      description: 'Three games, some pieces missing.', photos: [] }
  ];
  var REQUESTS = [
    { id: 'r1', listing: 'l1', from: 'ben', note: 'I can pick it up Saturday morning.', status: 'waiting', ago: '1 day ago' },
    { id: 'r2', listing: 'l1', from: 'dana', note: '', status: 'waiting', ago: '12 hours ago' },
    { id: 'r3', listing: 'l3', from: 'ben', note: 'My nephew would love this.', status: 'reserved', ago: '4 days ago' },
    { id: 'r5', listing: 'l7', from: 'ben', note: 'I can pick it up Sunday.', status: 'reserved', ago: '3 days ago' },
    { id: 'r6', listing: 'l7', from: 'ava', note: 'Still interested if it frees up.', status: 'waiting', ago: '2 days ago' },
    { id: 'r4', listing: 'w1', from: 'ava', note: 'I have six cages in the shed.', status: 'waiting', ago: '20 hours ago', offer: true }
  ];
  var REPORTS = [
    { id: 'p1', listing: 'l5', by: 'ben', reason: 'Item looks unsafe', detail: 'The height lever seems loose.', ago: '10 hours ago', status: 'open' },
    { id: 'p2', listing: 'l6', by: 'dana', reason: 'Wrong category', detail: '', ago: '2 days ago', status: 'open' },
    { id: 'p3', listing: 'l2', by: 'ava', reason: 'Not allowed on Family Exchange', detail: 'Please check the rules.', ago: '1 hour ago', status: 'open' }
  ];
  window.ExchangeSample = { PHOTOS: PHOTOS, VIEWERS: VIEWERS, LISTINGS: LISTINGS, REQUESTS: REQUESTS, REPORTS: REPORTS, FAMILY: 'Rowan family (sample)' };
})();
