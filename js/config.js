/*
 * Reset Society — site settings.
 * Everything the client may want to change lives here (prices, times, contact).
 * Values marked TODO are placeholders: confirm them with the client before launch.
 */
window.RS_CONFIG = {
  name: "Reset Society",
  tagline: "Wellness & Recovery Studio",
  city: "Umm Al Quwain",
  country: "UAE",

  // TODO: client's real WhatsApp number, digits only with country code (no +, no spaces).
  whatsapp: "971500000000",
  phoneDisplay: "+971 50 000 0000", // TODO
  instagram: "https://www.instagram.com/", // TODO: client's Instagram profile URL
  mapsQuery: "Umm Al Quwain, UAE", // TODO: exact studio address or Google Maps place name

  // TODO: confirm opening hours with the client.
  hours: [
    ["Saturday – Thursday", "9:00 AM – 7:00 PM"],
    ["Friday", "9:00 AM – 7:00 PM"]
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

  services: [
    {
      id: "cold-plunge",
      name: "Cold Plunge",
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
