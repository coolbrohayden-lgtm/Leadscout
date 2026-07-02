const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const cm = { top: 80, bottom: 80, left: 120, right: 120 };

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, font: 'Arial' })],
    spacing: { before: 300, after: 150 },
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, font: 'Arial' })],
    spacing: { before: 200, after: 100 },
  });
}
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 22, ...opts })],
    spacing: { before: 60, after: 60 },
  });
}
function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({ text, font: 'Arial', size: 22 })],
    spacing: { before: 40, after: 40 },
    indent: { left: 720, hanging: 360 },
  });
}
function row(label, value, shade) {
  return new TableRow({
    children: [
      new TableCell({
        borders, margins: cm,
        width: { size: 3000, type: WidthType.DXA },
        shading: shade ? { fill: 'E8F0F8', type: ShadingType.CLEAR } : undefined,
        children: [new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 22, bold: true })] })],
      }),
      new TableCell({
        borders, margins: cm,
        width: { size: 6360, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: value, font: 'Arial', size: 22 })] })],
      }),
    ],
  });
}

const doc = new Document({
  styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'LeadScout — Finding Restaurant Owner Contact Info', bold: true, size: 40, font: 'Arial' })],
        spacing: { before: 0, after: 200 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Context document for API/method selection advice', size: 22, font: 'Arial', color: '666666' })],
        spacing: { before: 0, after: 400 },
      }),

      h1('What is LeadScout?'),
      p('LeadScout is a Node.js web app + Chrome extension used by a social media sales team. It scans geographic areas on a map, finds restaurants via Google Places API, scrapes their websites for social media presence, and scores them as sales leads.'),
      p('The tool currently collects: restaurant name, address, phone, website, Google rating, Instagram handle + follower count, TikTok handle + follower count, Facebook page, and a lead score.'),
      p('Leads are stored in a shared Supabase (PostgreSQL) database. The sales team uses a CRM-style database page to filter, track status (contacted / interested / signed / denied), and export to CSV for cold calling.'),

      h1('The Problem We Are Trying To Solve'),
      p('Right now when the cold callers export leads and call restaurants, they reach the general phone number and often get a hostess or manager who cannot make decisions about marketing. The goal is to find the OWNER\'s direct contact information — name, direct phone number, or email — so the call goes straight to the decision maker.'),
      p('The restaurant data we already have per lead:'),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3000, 6360],
        rows: [
          row('Field', 'Example', true),
          row('name', 'Harry\'s Seafood Bar & Grille', false),
          row('address', '46 Avenida Menendez, St. Augustine, FL 32084', true),
          row('phone', '(904) 824-7765 (general line)', false),
          row('website', 'http://www.hookedonharrys.com', true),
          row('google_rating', '4.6', false),
          row('instagram', 'harrysseafood', true),
          row('place_id', 'ChIJ... (Google Places ID)', false),
        ],
      }),
      p(''),

      h1('What We Want'),
      p('An automated way — ideally as part of the scan or as a button in the CRM — to look up:'),
      bullet('Owner first and last name'),
      bullet('Owner direct phone number (not the restaurant\'s general line)'),
      bullet('Owner email address'),
      bullet('Owner LinkedIn (nice to have)'),
      p('This data would be added as new columns in the leads table and shown in the CRM so cold callers can call/email the owner directly.'),

      h1('Tech Stack Context'),
      p('The server is a plain Node.js http server (no frameworks). We make outbound HTTPS calls to external APIs. We already call:'),
      bullet('Google Places API (Nearby Search + Place Details)'),
      bullet('RapidAPI Instagram Statistics API'),
      bullet('TikTok internal API via Chrome extension'),
      p('We can add any new REST API call server-side. Our budget is low — free tiers or cheap APIs preferred. We have roughly 50-200 restaurants per scan session, and run 2-5 scans per day.'),

      h1('Approaches We Are Considering'),
      h2('1. WHOIS lookup on the restaurant website domain'),
      p('Many small restaurant websites are registered under the owner\'s personal name and contact info. A WHOIS API (e.g. whoisjson.com, api.whoapi.com) could return registrant name, email, phone from the domain of the restaurant\'s website.'),
      bullet('Pros: Free or very cheap, no scraping, works for owner-operated businesses'),
      bullet('Cons: Many use privacy protection services that hide the registrant data, larger chains use generic registrants'),

      h2('2. Hunter.io (email finder by domain)'),
      p('Hunter.io finds professional email addresses associated with a domain. Given "hookedonharrys.com" it might return owner@hookedonharrys.com or a named email like harry@hookedonharrys.com.'),
      bullet('Pros: Simple API, free tier (25/month), reliable for businesses with their own domain'),
      bullet('Cons: Many small restaurants use generic info@ addresses, $49/mo for 500 lookups'),

      h2('3. State business registry (e.g. Florida SunBiz)'),
      p('Florida\'s Division of Corporations (sunbiz.org) has a public search. Searching by business name returns the registered agent, which is often the owner or their lawyer, plus a mailing address.'),
      bullet('Pros: Free, official public data, highly accurate for FL businesses'),
      bullet('Cons: Florida only, requires scraping (no official API), business name matching can be fuzzy'),

      h2('4. OpenCorporates API'),
      p('OpenCorporates aggregates business registration data from all 50 US states. Free API for basic lookups. Returns company officers (often the owner) by business name.'),
      bullet('Pros: Covers all states, free tier, returns officer names'),
      bullet('Cons: Contact details (phone/email) not included — just names and registered addresses'),

      h2('5. Apollo.io / RocketReach / ZoomInfo'),
      p('B2B contact databases that have owner name, direct phone, and email for many businesses. Can search by company name or domain.'),
      bullet('Pros: Most complete data, direct phone numbers included'),
      bullet('Cons: Expensive ($100+/mo), overkill for small restaurant outreach'),

      h2('6. Google Knowledge Graph / Maps owner listing'),
      p('Some Google Maps listings have an "owner" field or are claimed by the owner. The Place Details API returns limited info but sometimes includes the owner\'s name in editorial_summary or attributes.'),
      bullet('Pros: Already have Place ID, no extra API cost'),
      bullet('Cons: Owner contact not returned by Places API — only public listing info'),

      h1('Our Question for You'),
      p('Given the context above, please advise:'),
      bullet('Which of the approaches above is the most practical for our use case — small US restaurants, budget-conscious, automated per scan?'),
      bullet('Is there a specific API or service we have not listed that would work better?'),
      bullet('What is the realistic hit rate — what percentage of small restaurants would we actually get owner contact info for with each method?'),
      bullet('Should we combine multiple methods (e.g. WHOIS first, then Hunter.io fallback)? In what order?'),
      bullet('Are there any legal or ethical considerations we should know about for US restaurant cold calling outreach using this data?'),
      p('Please include: service name, URL, free tier limits, paid tier pricing, and your recommended implementation order.', { color: '444444' }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\Leadfinder\\LeadScout_Owner_Contact_Context.docx', buf);
  console.log('Done: LeadScout_Owner_Contact_Context.docx');
});
