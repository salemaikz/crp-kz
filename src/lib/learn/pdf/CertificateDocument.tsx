// Макет PDF сертификата: A4 альбомный, белый фон, красная линия по краю, логотип слева сверху
// (BRAND.md, «Сертификат»). Без водяных знаков, теней, градиентов и колец. Без хуков и next-intl:
// все строки приходят в props.
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { COURSE_MAX_WIDTH, NAME_MAX_WIDTH, NAME_TRACKING, planCertificatePdf } from './plan';
import { qrPath } from './qr';
import { A4_LANDSCAPE, PDF_COLORS as C } from './theme';
import type { CertificatePdfInput } from './types';

/** Размеры в pt, пересчитаны с HTML-листа (1123 px по ширине = 841,89 pt). */
const LOGO_WIDTH = 185;
const LOGO_RATIO = 196 / 940;
const QR_SIZE = 84;
/** Белое поле вокруг QR, в модулях. */
const QR_QUIET = 4;

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, color: C.ink, fontFamily: 'Onest', fontWeight: 400 },
  frame: {
    position: 'absolute',
    top: 17,
    left: 17,
    right: 17,
    bottom: 17,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: C.accent,
    paddingTop: 29,
    paddingHorizontal: 39,
    paddingBottom: 27,
    flexDirection: 'column',
  },
  logo: { width: LOGO_WIDTH, height: LOGO_WIDTH * LOGO_RATIO },
  body: { flexGrow: 1, justifyContent: 'center' },
  title: { fontFamily: 'Geologica', fontWeight: 700, fontSize: 27, letterSpacing: -0.54, marginBottom: 14 },
  small: { fontSize: 12.6, color: C.muted },
  name: { fontFamily: 'Geologica', fontWeight: 700, maxWidth: NAME_MAX_WIDTH, lineHeight: 1.05, marginTop: 10, marginBottom: 12 },
  course: { fontFamily: 'Geologica', fontWeight: 700, maxWidth: COURSE_MAX_WIDTH, lineHeight: 1.15, marginTop: 10 },
  foot: { flexDirection: 'row', alignItems: 'flex-end' },
  facts: { flexGrow: 1, flexDirection: 'row' },
  fact: { marginRight: 28 },
  factLabel: { fontSize: 8.8, color: C.soft, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 3 },
  factValue: { fontSize: 13, fontWeight: 600 },
  sign: { width: LOGO_WIDTH, marginRight: 30, borderTopWidth: 1.2, borderTopStyle: 'solid', borderTopColor: C.ink, paddingTop: 5 },
  signOrg: { fontSize: 11, fontWeight: 600 },
  signPlace: { fontSize: 9.3, color: C.soft, marginTop: 3 },
  qr: { width: 104, alignItems: 'center' },
  qrTitle: { fontSize: 8, fontWeight: 600, marginTop: 5, textAlign: 'center' },
  qrHost: { fontSize: 8, color: C.soft, marginTop: 2, textAlign: 'center' },
});

type Props = CertificatePdfInput & { logo: Buffer };

export function CertificateDocument({ logo, ...c }: Props) {
  // ФИО и название курса приходят из БД: план чистит их от управляющих и bidi-символов и от символов,
  // которых нет в шрифте, и подбирает кегль. Недоступный план (plan.ok=false) сюда не доходит:
  // маршрут отвечает 303 раньше
  const { name, course: courseFit } = planCertificatePdf(c);
  const qr = qrPath(c.verifyUrl);
  const view = qr.size + QR_QUIET * 2;
  const l = c.labels;

  return (
    <Document
      title={l.metaTitle}
      author={l.org}
      creator={l.org}
      producer={l.org}
      language={c.locale === 'kz' ? 'kk' : 'ru'}
    >
      <Page size={[A4_LANDSCAPE.width, A4_LANDSCAPE.height]} style={s.page}>
        <View style={s.frame}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image из react-pdf, не DOM-<img>: alt в PDF не бывает */}
          <Image src={{ data: logo, format: 'png' }} style={s.logo} />

          <View style={s.body}>
            <Text style={s.title}>{l.title}</Text>
            <Text style={s.small}>{l.certifies}</Text>
            <Text style={[s.name, { fontSize: name.size, letterSpacing: NAME_TRACKING * name.size }]}>{name.text}</Text>
            <Text style={s.small}>{l.completed}</Text>
            <Text style={[s.course, { fontSize: courseFit.size }]}>{courseFit.text}</Text>
          </View>

          <View style={s.foot}>
            <View style={s.facts}>
              <View style={s.fact}>
                <Text style={s.factLabel}>{l.issued}</Text>
                <Text style={s.factValue}>{c.issuedDate}</Text>
              </View>
              <View style={s.fact}>
                <Text style={s.factLabel}>{l.number}</Text>
                <Text style={s.factValue}>{c.number}</Text>
              </View>
            </View>
            <View style={s.sign}>
              <Text style={s.signOrg}>{l.org}</Text>
              <Text style={s.signPlace}>{l.place}</Text>
            </View>
            <View style={s.qr}>
              <Svg width={QR_SIZE} height={QR_SIZE} viewBox={`${-QR_QUIET} ${-QR_QUIET} ${view} ${view}`}>
                <Path d={qr.d} fill={C.ink} />
              </Svg>
              <Text style={s.qrTitle}>{l.qrTitle}</Text>
              <Text style={s.qrHost}>{c.verifyHost}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
