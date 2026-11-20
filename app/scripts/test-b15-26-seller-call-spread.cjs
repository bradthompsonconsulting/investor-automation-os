/**
 * B15-26 (INV-134) spread warnings on Seller Call -- rendered. Jess GO 2026-11-11.
 *
 * Offline (scripts/harness/b15-27b/runner.cjs, fixture readyPlusB, synthetic contact A: ARV $650,000,
 * repairs $40,000, Standard Minimum mode, $5,000 standard minimum). Current Offer is seeded on the
 * opportunity carrier (fresh) or typed by the operator; nothing is approved and no write is asserted
 * or needed for the warning.
 *
 *   S0  no Current Offer: no status line; the Spread cell keeps its own waiting text (unchanged).
 *   S1  adequate:   green figure and "Meets the $5,000 standard minimum ... not a net-profit check".
 *   S2  below min:  amber figure and "$N short of the $5,000 standard minimum".
 *   S3  negative:   red figure and "Negative spread: this Current Offer is $N above ...".
 *   S4  typed:      an operator-typed Current Offer re-classifies the warning without a save.
 *   S5  layout:     the status line is inside the sticky bar, visible, uncovered, unclipped; the strip
 *                   keeps its seven labels and at most two rows.
 *
 * Spread figures are read from the rendered strip and compared against the rendered Max (Max = end-buyer
 * max - $5,000), so no number is restated here beyond the fixture's standard minimum.
 *
 * NEGATIVE CONTROL: --before=754a595 renders main's Seller Call page (no Seller Call warning) and must fail
 * S1-S5.
 */
const { run, readyPlusB } = require('./harness/b15-27b/runner.cjs');

const fixture = readyPlusB();
const money = (t) => Number(String(t).replace(/[^0-9.-]/g, ''));
const RED = 'rgb(239, 68, 68)', AMBER = 'rgb(245, 158, 11)', GREEN = 'rgb(34, 197, 94)', PLAIN = 'rgb(226, 232, 240)';

run({
  title: 'B15-26 Seller Call spread warnings',
  floor: 21,
  fixture,
  scenarios: async (c) => {
    const { page, check, fresh, until, settle } = c;
    const RA = fixture.A;
    const open = async (currentOffer) => {
      await fresh({ currentOffer }, `/contacts/${RA}/seller-call`);
      await page.getByTestId('negotiation-current-offer-input').waitFor({ timeout: 30000 });
      await until(async () => (await page.getByTestId('seller-call-deal-strip').innerText()).includes('$650,000'), 'deal strip with ARV');
    };
    const read = async () => page.evaluate(() => {
      const strip = document.querySelector('[data-testid="seller-call-deal-strip"]');
      const cells = [...strip.children].map((el) => ({ label: (el.firstElementChild?.textContent || '').trim(), text: el.innerText }));
      const fig = document.querySelector('[data-testid="deal-bar-value-spread"]');
      const st = document.querySelector('[data-testid="seller-call-spread-status"]');
      return {
        cells, max: (cells.find((x) => x.label === 'Max')?.text.split('\n').map((t) => t.trim()).find((t) => /^-?\$[\d,]+$/.test(t))) ?? null,
        spread: fig ? fig.textContent.trim() : null, spreadColor: fig ? getComputedStyle(fig).color : null,
        status: st ? { kind: st.getAttribute('data-spread-status'), role: st.getAttribute('role'), text: st.textContent.trim(), color: getComputedStyle(st).color } : null,
        spreadCellText: cells.find((x) => x.label === 'Spread')?.text ?? null,
      };
    });

    // S0 -- no Current Offer.
    await open(null);
    const s0 = await read();
    check('S0 no Current Offer: no spread status line (the cell names what is missing)',
      s0.status === null && /no Current Offer entered/.test(s0.spreadCellText || ''), s0);
    const MAX = money(s0.max);
    const EBM = MAX + 5000;
    check('S0 setup: Max is calculated from the synthetic deal', MAX > 300000, s0.max);

    // S1 -- adequate: spread $20,000 over the end-buyer max minus $5,000 minimum.
    await open(EBM - 25000);
    const s1 = await read();
    check('S1 adequate: status "meets" (role status)', s1.status?.kind === 'meets' && s1.status?.role === 'status', s1.status);
    check('S1 adequate: text names the minimum met and says it is not a net-profit check',
      /^Meets the \$5,000 standard minimum, \$\d[\d,]* above\. This is not a net-profit check\.$/.test(s1.status?.text || ''), s1.status);
    check('S1 adequate: Spread figure and text are green', s1.spreadColor === GREEN && s1.status?.color === GREEN, [s1.spreadColor, s1.status?.color]);

    // S2 -- below the standard minimum: spread about $3,000.
    await open(EBM - 3000);
    const s2 = await read();
    check('S2 below minimum: status "short"', s2.status?.kind === 'short', s2.status);
    check('S2 below minimum: text names the shortfall against the $5,000 standard minimum',
      /^\$\d[\d,]* short of the \$5,000 standard minimum\.$/.test(s2.status?.text || ''), s2.status);
    check('S2 below minimum: shortfall equals $5,000 minus the shown spread (within $1 rounding)',
      Math.abs(money((s2.status?.text || '').split(' short')[0]) - (5000 - money(s2.spread))) <= 1, [s2.status?.text, s2.spread]);
    check('S2 below minimum: Spread figure and text are amber', s2.spreadColor === AMBER && s2.status?.color === AMBER, [s2.spreadColor, s2.status?.color]);

    // S3 -- negative: Current Offer $4,000 above the end-buyer max.
    await open(EBM + 4000);
    const s3 = await read();
    check('S3 negative: status "negative"', s3.status?.kind === 'negative', s3.status);
    check('S3 negative: text names the Current Offer (not a Test Price) and the required minimum',
      /^Negative spread: this Current Offer is \$\d[\d,]* above the end buyer's maximum price, so there is no assignment spread\. Required: the \$5,000 standard minimum\.$/.test(s3.status?.text || ''), s3.status);
    check('S3 negative: the Spread figure itself is below zero', money(s3.spread) < 0, s3.spread);
    check('S3 negative: Spread figure and text are red', s3.spreadColor === RED && s3.status?.color === RED, [s3.spreadColor, s3.status?.color]);

    // S4 -- typed by the operator (no reload): adequate -> negative.
    await open(EBM - 25000);
    const input = page.getByTestId('negotiation-current-offer-input');
    await input.fill(String(EBM + 4000));
    await until(async () => (await read()).status?.kind === 'negative', 'typed offer re-classifies', 10000).catch(() => {});
    const s4 = await read();
    check('S4 a typed Current Offer re-classifies the warning to negative', s4.status?.kind === 'negative' && s4.spreadColor === RED, s4.status);
    await input.fill('');
    await settle(400);
    const s4b = await read();
    check('S4 clearing the typed offer removes the warning and the color', s4b.status === null && s4b.spreadColor !== RED && s4b.spreadColor !== GREEN && s4b.spreadColor !== AMBER, s4b);

    // S5 -- layout at the harness viewport.
    await open(EBM + 4000);
    const L = await page.evaluate(() => {
      const st = document.querySelector('[data-testid="seller-call-spread-status"]');
      const bar = document.querySelector('[data-testid="seller-call-sticky-bar"]');
      const strip = document.querySelector('[data-testid="seller-call-deal-strip"]');
      if (!st || !bar || !strip) return null;
      const b = st.getBoundingClientRect(); const bb = bar.getBoundingClientRect();
      const h = document.elementFromPoint(b.x + Math.min(20, b.width / 2), b.y + b.height / 2);
      return {
        inBar: bar.contains(st), visible: b.width > 0 && b.height > 0, uncovered: !!h && (h === st || st.contains(h)),
        unclipped: st.scrollWidth <= st.clientWidth + 1 && b.bottom <= bb.bottom + 0.5,
        rows: new Set([...strip.children].map((x) => Math.round(x.getBoundingClientRect().y))).size,
        labels: [...strip.children].map((x) => (x.firstElementChild?.textContent || '').trim()),
      };
    });
    check('S5 the status line sits in the sticky bar, visible and uncovered', !!L && L.inBar && L.visible && L.uncovered, L);
    check('S5 the status line is not clipped', !!L && L.unclipped, L);
    check('S5 the strip keeps its seven labels in order and at most two rows',
      !!L && JSON.stringify(L.labels) === JSON.stringify(['ARV', 'Repairs', 'Seller Position', 'Current Offer', 'Target', 'Max', 'Spread']) && L.rows <= 2, L);
    check('S5 other strip figures stay the plain color', await page.evaluate((plain) => {
      const strip = document.querySelector('[data-testid="seller-call-deal-strip"]');
      const max = [...strip.children].find((x) => (x.firstElementChild?.textContent || '').trim() === 'Max');
      const fig = max && [...max.querySelectorAll('span')].find((s) => /Space Grotesk/.test(getComputedStyle(s).fontFamily));
      return !!fig && getComputedStyle(fig).color === plain;
    }, PLAIN));
  },
});
