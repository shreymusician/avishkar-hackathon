// Government schemes for farmers. There is no public API for these (the myScheme portal answers "Unauthorized"
// without a key it does not issue), so this is a reviewed list. Each entry links to a site where the scheme can be
// checked and applied for, and the page tells the reader to confirm amounts and rules there: schemes change, so
// nothing here is a promise.
//
// level: 'central' (Government of India) or 'state' (Karnataka). `kind` groups them for the filter chips.
// `name` is the official name and stays in English; `summary` and `who` come in English, Kannada and Hindi.
// `site: 'myscheme'` marks a link to the national scheme-search portal instead of the scheme's own site.

export const SCHEME_KINDS = ['income', 'insurance', 'credit', 'irrigation', 'inputs', 'market', 'help'];

export const SCHEMES = [
  {
    id: 'pm-kisan',
    level: 'central',
    kind: 'income',
    name: 'PM-KISAN',
    url: 'https://pmkisan.gov.in',
    summary: {
      en: 'Income support of ₹6,000 a year, paid in three instalments straight into the bank account.',
      kn: 'ವರ್ಷಕ್ಕೆ ₹6,000 ಆದಾಯ ಬೆಂಬಲ, ಮೂರು ಕಂತುಗಳಲ್ಲಿ ನೇರವಾಗಿ ಬ್ಯಾಂಕ್ ಖಾತೆಗೆ ಜಮೆ.',
      hi: 'साल में ₹6,000 की आय सहायता, तीन किस्तों में सीधे बैंक खाते में।',
    },
    who: {
      en: 'Landholding farmer families (some groups are excluded).',
      kn: 'ಭೂಮಿ ಹೊಂದಿರುವ ರೈತ ಕುಟುಂಬಗಳು (ಕೆಲವು ವರ್ಗಗಳಿಗೆ ಅನ್ವಯಿಸುವುದಿಲ್ಲ).',
      hi: 'जमीन वाले किसान परिवार (कुछ वर्ग शामिल नहीं हैं)।',
    },
  },
  {
    id: 'pmfby',
    level: 'central',
    kind: 'insurance',
    name: 'Pradhan Mantri Fasal Bima Yojana (PMFBY)',
    url: 'https://pmfby.gov.in',
    summary: {
      en: 'Crop insurance against loss from drought, flood, pests and disease, for a small premium paid by the farmer.',
      kn: 'ಬರ, ಪ್ರವಾಹ, ಕೀಟ ಮತ್ತು ರೋಗದಿಂದ ಆಗುವ ಬೆಳೆ ನಷ್ಟಕ್ಕೆ ವಿಮೆ; ರೈತ ಸಣ್ಣ ಪ್ರೀಮಿಯಂ ಪಾವತಿಸಬೇಕು.',
      hi: 'सूखा, बाढ़, कीट और रोग से फसल नुकसान पर बीमा; किसान को केवल थोड़ा प्रीमियम देना होता है।',
    },
    who: {
      en: 'Farmers growing notified crops in notified areas.',
      kn: 'ಅಧಿಸೂಚಿತ ಪ್ರದೇಶಗಳಲ್ಲಿ ಅಧಿಸೂಚಿತ ಬೆಳೆ ಬೆಳೆಯುವ ರೈತರು.',
      hi: 'अधिसूचित क्षेत्रों में अधिसूचित फसल उगाने वाले किसान।',
    },
  },
  {
    id: 'kcc',
    level: 'central',
    kind: 'credit',
    name: 'Kisan Credit Card (KCC)',
    url: 'https://www.myscheme.gov.in/search',
    site: 'myscheme',
    summary: {
      en: 'Short-term farm loans at low interest, with interest relief for repaying on time. Apply at your bank.',
      kn: 'ಕಡಿಮೆ ಬಡ್ಡಿಯ ಅಲ್ಪಾವಧಿ ಕೃಷಿ ಸಾಲ; ಸಮಯಕ್ಕೆ ಮರುಪಾವತಿಸಿದರೆ ಬಡ್ಡಿ ರಿಯಾಯಿತಿ. ನಿಮ್ಮ ಬ್ಯಾಂಕ್‌ನಲ್ಲಿ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ.',
      hi: 'कम ब्याज पर अल्पकालिक कृषि ऋण; समय पर चुकाने पर ब्याज में राहत। अपने बैंक में आवेदन करें।',
    },
    who: {
      en: 'Farmers, tenant farmers and sharecroppers; dairy and fisheries farmers too.',
      kn: 'ರೈತರು, ಹಿಡುವಳಿದಾರರು, ಪಾಲುದಾರ ಕೃಷಿಕರು; ಹೈನುಗಾರರು ಮತ್ತು ಮೀನುಗಾರರೂ ಸಹ.',
      hi: 'किसान, किरायेदार और बटाईदार किसान; पशुपालक और मछली पालक भी।',
    },
  },
  {
    id: 'soil-health',
    level: 'central',
    kind: 'inputs',
    name: 'Soil Health Card',
    url: 'https://soilhealth.dac.gov.in',
    summary: {
      en: 'Free soil testing and a card with crop-wise fertiliser advice for your field.',
      kn: 'ಉಚಿತ ಮಣ್ಣು ಪರೀಕ್ಷೆ ಮತ್ತು ನಿಮ್ಮ ಹೊಲಕ್ಕೆ ಬೆಳೆವಾರು ಗೊಬ್ಬರ ಸಲಹೆಯ ಕಾರ್ಡ್.',
      hi: 'मुफ़्त मिट्टी जाँच और आपके खेत के लिए फसल-वार खाद सलाह वाला कार्ड।',
    },
    who: {
      en: 'All farmers.',
      kn: 'ಎಲ್ಲಾ ರೈತರು.',
      hi: 'सभी किसान।',
    },
  },
  {
    id: 'pm-kusum',
    level: 'central',
    kind: 'irrigation',
    name: 'PM-KUSUM',
    url: 'https://pmkusum.mnre.gov.in',
    summary: {
      en: 'Subsidy for solar irrigation pumps and for setting up solar power on farmland.',
      kn: 'ಸೌರ ನೀರಾವರಿ ಪಂಪ್‌ಗಳು ಮತ್ತು ಹೊಲದಲ್ಲಿ ಸೌರ ವಿದ್ಯುತ್ ಘಟಕಕ್ಕೆ ಸಹಾಯಧನ.',
      hi: 'सोलर सिंचाई पंप और खेत में सोलर बिजली संयंत्र लगाने पर सब्सिडी।',
    },
    who: {
      en: 'Farmers, through the state nodal agency.',
      kn: 'ರೈತರು, ರಾಜ್ಯದ ನೋಡಲ್ ಏಜೆನ್ಸಿ ಮೂಲಕ.',
      hi: 'किसान, राज्य की नोडल एजेंसी के माध्यम से।',
    },
  },
  {
    id: 'pmksy',
    level: 'central',
    kind: 'irrigation',
    name: 'PM Krishi Sinchayee Yojana (PMKSY)',
    url: 'https://pmksy.gov.in',
    summary: {
      en: 'Support for drip and sprinkler irrigation, so every drop of water grows more crop.',
      kn: 'ಹನಿ ಮತ್ತು ತುಂತುರು ನೀರಾವರಿಗೆ ಬೆಂಬಲ; ಪ್ರತಿ ಹನಿ ನೀರಿನಿಂದ ಹೆಚ್ಚು ಬೆಳೆ.',
      hi: 'ड्रिप और स्प्रिंकलर सिंचाई के लिए सहायता, ताकि हर बूंद से ज्यादा फसल हो।',
    },
    who: {
      en: 'Farmers taking up micro-irrigation.',
      kn: 'ಸೂಕ್ಷ್ಮ ನೀರಾವರಿ ಅಳವಡಿಸಿಕೊಳ್ಳುವ ರೈತರು.',
      hi: 'सूक्ष्म सिंचाई अपनाने वाले किसान।',
    },
  },
  {
    id: 'e-nam',
    level: 'central',
    kind: 'market',
    name: 'e-NAM (National Agriculture Market)',
    url: 'https://enam.gov.in',
    summary: {
      en: 'A national online market where farmers can sell produce to buyers across many mandis.',
      kn: 'ದೇಶದಾದ್ಯಂತ ಹಲವು ಮಂಡಿಗಳ ಖರೀದಿದಾರರಿಗೆ ಬೆಳೆ ಮಾರಾಟ ಮಾಡಲು ರಾಷ್ಟ್ರೀಯ ಆನ್‌ಲೈನ್ ಮಾರುಕಟ್ಟೆ.',
      hi: 'देशभर की कई मंडियों के खरीदारों को उपज बेचने के लिए राष्ट्रीय ऑनलाइन बाज़ार।',
    },
    who: {
      en: 'Farmers who register at an e-NAM mandi.',
      kn: 'e-NAM ಮಂಡಿಯಲ್ಲಿ ನೋಂದಾಯಿಸಿಕೊಂಡ ರೈತರು.',
      hi: 'e-NAM मंडी में पंजीकृत किसान।',
    },
  },
  {
    id: 'aif',
    level: 'central',
    kind: 'credit',
    name: 'Agriculture Infrastructure Fund (AIF)',
    url: 'https://agriinfra.dac.gov.in',
    summary: {
      en: 'Loans with interest relief for storage, cold chains and processing near the farm.',
      kn: 'ಹೊಲದ ಬಳಿ ದಾಸ್ತಾನು, ಶೀತಲ ಸರಪಳಿ ಮತ್ತು ಸಂಸ್ಕರಣೆಗೆ ಬಡ್ಡಿ ರಿಯಾಯಿತಿಯ ಸಾಲ.',
      hi: 'खेत के पास भंडारण, कोल्ड चेन और प्रसंस्करण के लिए ब्याज राहत वाला ऋण।',
    },
    who: {
      en: 'Farmers, FPOs, cooperatives and agri-entrepreneurs.',
      kn: 'ರೈತರು, ರೈತ ಉತ್ಪಾದಕ ಸಂಸ್ಥೆಗಳು, ಸಹಕಾರ ಸಂಘಗಳು ಮತ್ತು ಕೃಷಿ ಉದ್ಯಮಿಗಳು.',
      hi: 'किसान, एफपीओ, सहकारी समितियाँ और कृषि उद्यमी।',
    },
  },
  {
    id: 'pm-kmy',
    level: 'central',
    kind: 'income',
    name: 'PM Kisan Maandhan Yojana (PM-KMY)',
    url: 'https://maandhan.in',
    summary: {
      en: 'A monthly pension of ₹3,000 after age 60 for small and marginal farmers who contribute while young.',
      kn: 'ಯೌವನದಲ್ಲಿ ವಂತಿಗೆ ನೀಡುವ ಸಣ್ಣ ಮತ್ತು ಅತಿ ಸಣ್ಣ ರೈತರಿಗೆ 60 ವರ್ಷದ ನಂತರ ತಿಂಗಳಿಗೆ ₹3,000 ಪಿಂಚಣಿ.',
      hi: 'जो छोटे और सीमांत किसान जवानी में अंशदान देते हैं, उन्हें 60 वर्ष के बाद हर महीने ₹3,000 पेंशन।',
    },
    who: {
      en: 'Small and marginal farmers aged 18 to 40.',
      kn: '18 ರಿಂದ 40 ವರ್ಷದ ಸಣ್ಣ ಮತ್ತು ಅತಿ ಸಣ್ಣ ರೈತರು.',
      hi: '18 से 40 वर्ष के छोटे और सीमांत किसान।',
    },
  },
  {
    id: 'pkvy',
    level: 'central',
    kind: 'inputs',
    name: 'Paramparagat Krishi Vikas Yojana (PKVY)',
    url: 'https://pgsindia-ncof.gov.in',
    summary: {
      en: 'Help for groups of farmers to take up organic farming.',
      kn: 'ರೈತರ ಗುಂಪುಗಳು ಸಾವಯವ ಕೃಷಿ ಕೈಗೊಳ್ಳಲು ನೆರವು.',
      hi: 'किसानों के समूहों को जैविक खेती अपनाने में सहायता।',
    },
    who: {
      en: 'Farmer groups (clusters).',
      kn: 'ರೈತರ ಗುಂಪುಗಳು (ಕ್ಲಸ್ಟರ್).',
      hi: 'किसानों के समूह (क्लस्टर)।',
    },
  },
  {
    id: 'smam',
    level: 'central',
    kind: 'inputs',
    name: 'Sub-Mission on Agricultural Mechanization (SMAM)',
    url: 'https://agrimachinery.nic.in',
    summary: {
      en: 'Subsidy on tractors and farm machines, and on centres that hire machinery out.',
      kn: 'ಟ್ರ್ಯಾಕ್ಟರ್ ಮತ್ತು ಕೃಷಿ ಯಂತ್ರಗಳಿಗೆ ಹಾಗೂ ಯಂತ್ರ ಬಾಡಿಗೆ ಕೇಂದ್ರಗಳಿಗೆ ಸಹಾಯಧನ.',
      hi: 'ट्रैक्टर और कृषि मशीनों तथा मशीन किराया केंद्रों पर सब्सिडी।',
    },
    who: {
      en: 'Farmers, groups and custom-hiring centres.',
      kn: 'ರೈತರು, ಗುಂಪುಗಳು ಮತ್ತು ಬಾಡಿಗೆ ಕೇಂದ್ರಗಳು.',
      hi: 'किसान, समूह और कस्टम हायरिंग केंद्र।',
    },
  },
  {
    id: 'raitha-siri',
    level: 'state',
    kind: 'inputs',
    name: 'Raitha Siri',
    url: 'https://raitamitra.karnataka.gov.in',
    summary: {
      en: "Karnataka's incentive for farmers who grow millets such as ragi and jowar.",
      kn: 'ರಾಗಿ, ಜೋಳದಂತಹ ಸಿರಿಧಾನ್ಯ ಬೆಳೆಯುವ ರೈತರಿಗೆ ಕರ್ನಾಟಕ ಸರ್ಕಾರದ ಪ್ರೋತ್ಸಾಹ.',
      hi: 'रागी और ज्वार जैसे मोटे अनाज उगाने वाले किसानों के लिए कर्नाटक सरकार का प्रोत्साहन।',
    },
    who: {
      en: 'Karnataka farmers growing millets.',
      kn: 'ಸಿರಿಧಾನ್ಯ ಬೆಳೆಯುವ ಕರ್ನಾಟಕದ ರೈತರು.',
      hi: 'मोटे अनाज उगाने वाले कर्नाटक के किसान।',
    },
  },
  {
    id: 'rsk',
    level: 'state',
    kind: 'help',
    name: 'Raitha Samparka Kendra (RSK)',
    url: 'https://raitamitra.karnataka.gov.in',
    summary: {
      en: 'Your nearest Raitha Samparka Kendra gives seeds, advice and help applying for schemes.',
      kn: 'ನಿಮ್ಮ ಹತ್ತಿರದ ರೈತ ಸಂಪರ್ಕ ಕೇಂದ್ರದಲ್ಲಿ ಬೀಜ, ಸಲಹೆ ಮತ್ತು ಯೋಜನೆಗಳಿಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ನೆರವು ಸಿಗುತ್ತದೆ.',
      hi: 'आपके नज़दीकी रैयत संपर्क केंद्र पर बीज, सलाह और योजनाओं में आवेदन की मदद मिलती है।',
    },
    who: {
      en: 'All Karnataka farmers.',
      kn: 'ಕರ್ನಾಟಕದ ಎಲ್ಲಾ ರೈತರು.',
      hi: 'कर्नाटक के सभी किसान।',
    },
  },
  {
    id: 'bhoomi',
    level: 'state',
    kind: 'help',
    name: 'Bhoomi land records (RTC)',
    url: 'https://landrecords.karnataka.gov.in',
    summary: {
      en: 'Land records (RTC) online. Most schemes and loans ask for them.',
      kn: 'ಭೂ ದಾಖಲೆಗಳು (ಆರ್‌ಟಿಸಿ) ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ. ಹೆಚ್ಚಿನ ಯೋಜನೆಗಳು ಮತ್ತು ಸಾಲಗಳಿಗೆ ಇವು ಬೇಕು.',
      hi: 'भूमि अभिलेख (आरटीसी) ऑनलाइन। ज़्यादातर योजनाओं और ऋण में ये माँगे जाते हैं।',
    },
    who: {
      en: 'Landowners in Karnataka.',
      kn: 'ಕರ್ನಾಟಕದ ಭೂ ಮಾಲೀಕರು.',
      hi: 'कर्नाटक के भू-स्वामी।',
    },
  },
];
