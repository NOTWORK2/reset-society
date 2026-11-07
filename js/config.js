/*
 * Reset Society — site settings.
 * Fields ending in _ar are the Arabic versions shown when the site is in Arabic.
 * Everything the client may want to change lives here (prices, times, contact).
 * Values marked TODO are placeholders: confirm them with the client before launch.
 */
window.RS_CONFIG = {
  name: "Reset Society",
  tagline: "Wellness & Recovery Studio",
  city: "Umm Al Quwain",
  city_ar: "أم القيوين",
  country: "UAE",
  country_ar: "الإمارات",

  // TODO: client's real WhatsApp number, digits only with country code (no +, no spaces).
  whatsapp: "971500000000",
  phoneDisplay: "+971 50 000 0000", // TODO
  instagram: "https://www.instagram.com/", // TODO: client's Instagram profile URL
  mapsQuery: "Umm Al Quwain, UAE", // TODO: exact studio address or Google Maps place name

  // TODO: confirm opening hours with the client.
  hours: [
    { days: "Saturday – Thursday", days_ar: "السبت – الخميس", time: "9:00 AM – 7:00 PM", time_ar: "9:00 ص – 7:00 م" },
    { days: "Friday", days_ar: "الجمعة", time: "9:00 AM – 7:00 PM", time_ar: "9:00 ص – 7:00 م" }
  ],

  currency: "AED",
  timeZone: "Asia/Dubai",
  utcOffsetHours: 4, // UAE has no daylight saving

  booking: {
    daysAhead: 60,        // how far ahead a session can be booked
    minLeadMinutes: 60,   // a slot today must start at least this long from now
    closedWeekdays: [],   // 0 = Sunday … 6 = Saturday, e.g. [5] closes Fridays
    slots: ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
  },

  payment: {
    // Online payment needs a payment provider account (e.g. Stripe, Ziina, Telr).
    // Leave false until one is set up; the option then shows as "Coming soon".
    online: false
  },

  // Memberships (monthly) and session packs. Editable from the admin Settings tab.
  // TODO: confirm session-pack prices and validity with the client (memberships are from the design).
  plans: {
    serviceId: "full-recovery", // memberships and packs are for this service
    memberships: [
      { id: "m4", sessions: 4, price: 400, image: "assets/img/sauna.jpg" },
      { id: "m8", sessions: 8, price: 750, image: "assets/img/cold-plunge.jpg" },
      { id: "m12", sessions: 12, price: 1100, image: "assets/img/full-recovery.jpg", featured: true }
    ],
    packs: [
      // Same sessions as the memberships (client's request). TODO: confirm pack prices and validity.
      { id: "p4", sessions: 4, price: 400, image: "assets/img/sauna.jpg" },
      { id: "p8", sessions: 8, price: 750, image: "assets/img/cold-plunge.jpg" },
      { id: "p12", sessions: 12, price: 1100, image: "assets/img/full-recovery.jpg", featured: true }
    ]
  },

  services: [
    {
      id: "cold-plunge",
      name: "Cold Plunge",
      name_ar: "الغطس البارد",
      duration_ar: "10 إلى 15 دقيقة",
      short_ar: "يسرّع التعافي ويخفّف الالتهاب.",
      long_ar: "غطس بارد مدروس يهدّئ الالتهاب ويزيد التركيز ويمنحك طاقة متجددة.",
      price: 50,
      duration: "10–15 min",
      minutes: 15,
      capacity: 1, // guests per time slot — keep in sync with firestore.rules
      short: "Boost recovery and reduce inflammation.",
      long: "Controlled cold immersion that calms inflammation, sharpens focus and leaves you energised.",
      image: "assets/img/cold-plunge.jpg"
    },
    {
      id: "sauna",
      name: "Sauna",
      name_ar: "الساونا",
      duration_ar: "20 إلى 30 دقيقة",
      short_ar: "استرخاء وتعافٍ وتحسين للدورة الدموية.",
      long_ar: "حرارة جافة عميقة ترخي العضلات المشدودة وتحسّن الدورة الدموية وتهدّئ الذهن.",
      price: 50,
      duration: "20–30 min",
      minutes: 30,
      capacity: 1,
      short: "Relax, recover and improve circulation.",
      long: "Deep, dry heat to loosen tight muscles, improve circulation and quiet the mind.",
      image: "assets/img/sauna.jpg"
    },
    {
      id: "compression-boots",
      name: "Compression Boots",
      name_ar: "أحذية الضغط",
      duration_ar: "20 إلى 30 دقيقة",
      short_ar: "يخفّف التورّم ويعزّز التعافي.",
      long_ar: "ضغط هوائي متدرّج ينعش الساقين المتعبتين ويخفّف التورّم ويسرّع التعافي.",
      price: 40,
      duration: "20–30 min",
      minutes: 30,
      capacity: 1,
      short: "Reduce swelling and enhance recovery.",
      long: "Pneumatic compression that flushes tired legs, reduces swelling and speeds up recovery.",
      image: "assets/img/compression-boots.jpg"
    },
    {
      id: "full-recovery",
      name: "Full Recovery",
      name_ar: "التعافي الكامل",
      duration_ar: "40 إلى 60 دقيقة",
      short_ar: "ساونا + غطس بارد + أحذية الضغط.",
      long_ar: "الطقس الكامل: حرارة وبرودة وضغط في جلسة واحدة لتجديد شامل.",
      price: 120,
      duration: "40–60 min",
      minutes: 60,
      capacity: 1,
      short: "Sauna + Cold Plunge + Compression Boots.",
      long: "The complete ritual: heat, cold and compression in one session, for a full reset.",
      image: "assets/img/full-recovery.jpg",
      featured: true
    }
  ]
};

/* Settings saved from the admin dashboard (Firestore: settings/site) replace the values above.
   The last copy is kept in the browser so returning visitors see current prices immediately. */
window.RS_applySite = function (site) {
  const C = window.RS_CONFIG;
  if (!site) return;
  ["services", "hours", "whatsapp", "phoneDisplay", "instagram", "mapsQuery", "policy", "plans"].forEach((k) => {
    if (site[k] !== undefined && site[k] !== null) C[k] = site[k];
  });
  if (site.booking) Object.assign(C.booking, site.booking);
};
try {
  const cached = JSON.parse(localStorage.getItem("rs-site"));
  if (cached) window.RS_applySite(cached);
} catch (e) { /* no cache */ }
