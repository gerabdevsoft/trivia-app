import React, { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "@/src/theme";

const proposalPage = require("../../assets/proposals/propuestas.jpg");
const leafletPage = require("../../assets/proposals/triptico.jpg");
const coverImage = require("../../assets/proposals/cover.jpg");
// Bundled image dimensions; resolveAssetSource is not available on React Native Web.
const coverAspectRatio = 650 / 1377;

const commitments = [
  {
    number: "01",
    title: "Motivación docente",
    detail:
      "Herramientas, incentivos, becas, formación y estabilidad para quienes están todos los días frente al aula.",
  },
  {
    number: "02",
    title: "Filas cero",
    detail:
      "Trámites académicos enteramente virtuales con documentos digitales para que nunca más hagas fila.",
  },
  {
    number: "03",
    title: "Becas al mil por mil",
    detail:
      "Universidad enérgicamente internacionalizada. Una de nuestras prioridades será obtener más presupuesto para becas internas y gestionar externas para docentes y estudiantes.",
  },
  {
    number: "04",
    title: "Investigar para resolver",
    detail:
      "Tesis e investigaciones que además de producir conocimiento ayuden a enfrentar problemas reales.",
  },
  {
    number: "05",
    title: "Una universidad presente",
    detail:
      "Más proyectos donde estudiantes y docentes aprendan trabajando con Chuquisaca.",
  },
  {
    number: "06",
    title: "Hacer posible el cambio",
    detail:
      "Gestión, alianzas y cooperación para convertir las buenas ideas en resultados.",
  },
];

function SectionHeading({
  index,
  title,
  dark = false,
}: {
  index: string;
  title: string;
  dark?: boolean;
}) {
  return (
    <View style={styles.headingRow}>
      <Text style={[styles.sectionIndex, dark && styles.textOnRed]}>{index}</Text>
      <View style={styles.headingTextWrap}>
        <View style={[styles.headingRule, dark && styles.headingRuleLight]} />
        <Text style={[styles.sectionTitle, dark && styles.textOnRed]}>{title}</Text>
      </View>
    </View>
  );
}

export default function ProposalSection() {
  const [pagesVisible, setPagesVisible] = useState(false);

  return (
    <View style={styles.outer}>
      <View style={styles.intro}>
        <View style={styles.eyebrowLine} />
        <Text style={styles.eyebrow}>UNA PROPUESTA PARA SAN FRANCISCO XAVIER</Text>
        <Text style={styles.title}>Tu futuro empieza aquí.</Text>
        <Text style={styles.introCopy}>
          Formación, experiencia y oportunidades: conoce las ideas de Yamile Hayes
          para una universidad que acompaña.
        </Text>
      </View>

      <View style={styles.coverFrame}>
        <View style={{ width: "100%", aspectRatio: coverAspectRatio }}>
          <Image
            source={coverImage}
            style={styles.pageImage}
            resizeMode="contain"
            accessible
            accessibilityLabel="Afiche de Yamile Hayes, Vicerrectora. Tu futuro empieza aquí."
          />
        </View>
        <View style={styles.coverCaption}>
          <Text style={styles.coverCaptionText}>YAMILE HAYES · VICERRECTORA</Text>
          <Text style={styles.coverSubcaption}>Universidad San Francisco Xavier de Chuquisaca</Text>
        </View>
      </View>

      <View style={styles.proposalCard}>
        <SectionHeading index="01" title="Tu futuro empieza ahora" />
        <Text style={styles.lead}>
          No esperes a titularte para empezar a construir tu camino.
        </Text>
        <Text style={styles.body}>
          Impulsaremos una formación con prácticas tempranas, proyectos reales,
          orientación profesional, certificaciones progresivas cuando
          correspondan, preparación para el empleo y el emprendimiento, y mayor
          vinculación con instituciones y sectores profesionales.
        </Text>
        <Text style={styles.overline}>PARA QUE PUEDAS</Text>
        <View style={styles.pathList}>
          {["Aprender", "Practicar", "Demostrar lo que sabes", "Encontrar oportunidades"].map(
            (item, index) => (
              <View style={styles.pathItem} key={item}>
                <View style={styles.pathRail}>
                  <View style={[styles.pathDot, index === 3 && styles.pathDotLast]} />
                  {index < 3 && <View style={styles.pathConnector} />}
                </View>
                <Text style={[styles.pathText, index === 3 && styles.pathTextLast]}>
                  {item}
                </Text>
              </View>
            ),
          )}
        </View>
        <View style={styles.callout}>
          <Text style={styles.calloutText}>
            Tu título será importante.{"\n"}Tu experiencia también.
          </Text>
        </View>
      </View>

      <View style={styles.redPanel}>
        <SectionHeading index="02" title="La universidad te acompaña" dark />
        <Text style={styles.leadLight}>
          Desde que ingresas hasta que empiezas tu vida profesional.
        </Text>
        <Text style={styles.bodyLight}>
          Promoveremos tutorías, orientación académica, acompañamiento durante
          la carrera y apoyo para prácticas, titulación, empleo, emprendimiento
          y formación posterior.
        </Text>
        <View style={styles.panelDivider} />
        <Text style={styles.panelStatement}>
          Una gran universidad{"\n"}no solo enseña.{"\n"}También acompaña.
        </Text>

        <View style={styles.sectionBreak}>
          <SectionHeading index="03" title="Aprender para el mundo real" dark />
          <Text style={styles.bodyLight}>
            Impulsaremos currículos más conectados con la realidad, proyectos
            reales, prácticas, competencias digitales, uso responsable de
            inteligencia artificial, investigación y nuevas metodologías de
            aprendizaje.
          </Text>
          <View style={styles.panelDivider} />
          <Text style={styles.panelStatementSmall}>
            Menos distancia entre lo que estudias y lo que harás afuera.
          </Text>
        </View>
      </View>

      <View style={styles.commitmentsBlock}>
        <Text style={styles.commitmentsKicker}>SEIS ACCIONES, UN MISMO PROPÓSITO</Text>
        <Text style={styles.commitmentsTitle}>
          Compromisos para una universidad mejor
        </Text>
        <View style={styles.commitmentList}>
          {commitments.map((item) => (
            <View style={styles.commitment} key={item.number}>
              <Text style={styles.commitmentNumber}>{item.number}</Text>
              <View style={styles.commitmentCopy}>
                <Text style={styles.commitmentTitle}>{item.title}</Text>
                <Text style={styles.commitmentDetail}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.closingMark}>
          <Text style={styles.heartMark}>♡</Text>
          <Text style={styles.closingText}>Construyamos Nuestro Futuro</Text>
        </View>
      </View>

      <View style={styles.leafletPanel}>
        <Text style={styles.leafletKicker}>LA VISIÓN COMPLETA</Text>
        <Text style={styles.leafletTitle}>Una universidad con futuro</Text>
        <Text style={styles.leafletBody}>
          Nuevas ideas. Nuevas oportunidades. Una universidad que esté a la
          altura de los retos de la sociedad y los desafíos del siglo XXI.
        </Text>
        <View style={styles.pillars}>
          {["Acompaña", "Prepara", "Forma", "Escucha", "Innova"].map((pillar) => (
            <View style={styles.pillar} key={pillar}>
              <Text style={styles.pillarText}>{pillar}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.leafletBody}>
          Práctica real para que sus estudiantes transformen los problemas de hoy.
        </Text>
        <View style={styles.leafletDivider} />
        <Text style={styles.leafletSubhead}>La universidad que queremos</Text>
        <Text style={styles.leafletBody}>
          Estudiar debe significar mucho más que aprobar materias y llegar a la
          titulación.{"\n\n"}
          Queremos una San Francisco Xavier que te acompañe, que acerque la
          formación a la realidad y que te ayude a construir experiencia y
          oportunidades desde antes de egresar.{"\n\n"}
          Una Universidad que cuide su historia, pero que también tenga el valor
          de preparar el futuro.
        </Text>
        <Text style={styles.leafletPromise}>
          Ese futuro lo construimos contigo.
        </Text>
        <Text style={styles.leafletFooter}>Es contigo. Es con todos.</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver las páginas originales de la propuesta"
        onPress={() => setPagesVisible(true)}
        style={({ pressed }) => [styles.viewPagesButton, pressed && styles.pressed]}
      >
        <Text style={styles.viewPagesLabel}>Ver páginas originales</Text>
        <Text style={styles.viewPagesArrow}>↗</Text>
      </Pressable>

      <Modal
        visible={pagesVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPagesVisible(false)}
      >
        <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>DOCUMENTOS ORIGINALES</Text>
              <Text style={styles.modalTitle}>La propuesta completa</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar páginas originales"
              onPress={() => setPagesVisible(false)}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonText}>Cerrar</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.documentScroll}
            contentContainerStyle={styles.documentContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
            pinchGestureEnabled
          >
            <View style={styles.documentPage}>
              <Image
                source={proposalPage}
                style={styles.pageImage}
                resizeMode="contain"
                accessible
                accessibilityLabel="Página original de la propuesta: Tu futuro empieza ahora, la universidad te acompaña, aprender para el mundo real y seis compromisos."
              />
            </View>
            <View style={styles.documentPage}>
              <Image
                source={leafletPage}
                style={styles.pageImage}
                resizeMode="contain"
                accessible
                accessibilityLabel="Tríptico original: Una universidad con futuro, la universidad que queremos y afiche de Yamile Hayes."
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: "100%", maxWidth: 760, alignSelf: "center", paddingTop: 24, paddingBottom: 40 },
  intro: { paddingHorizontal: 3, paddingBottom: 19 },
  eyebrowLine: { width: 34, height: 4, borderRadius: 3, backgroundColor: COLORS.primary, marginBottom: 11 },
  eyebrow: { color: COLORS.primaryDark, fontSize: 10, fontWeight: "700", letterSpacing: 1.5, marginBottom: 7 },
  title: { color: "#40191D", fontSize: 31, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  introCopy: { color: "#68575A", fontSize: 16, lineHeight: 24, marginTop: 8, maxWidth: 540 },
  coverFrame: {
    overflow: "hidden", borderRadius: 18, backgroundColor: COLORS.primaryDark, marginBottom: 14,
    shadowColor: "#6B101B", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.14,
    shadowRadius: 13, elevation: 4,
  },
  pageImage: { width: "100%", height: "100%" },
  coverCaption: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.primaryDark },
  coverCaptionText: { color: "#FFF8F3", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  coverSubcaption: { color: "#FFE3E0", fontSize: 11, lineHeight: 16, marginTop: 3 },
  proposalCard: {
    backgroundColor: "#FFFDFC", borderColor: "#F1DADC", borderWidth: 1, borderRadius: 17,
    paddingHorizontal: 18, paddingVertical: 21, marginTop: 5, marginBottom: 14,
  },
  headingRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  sectionIndex: { color: COLORS.primary, fontSize: 26, lineHeight: 30, fontWeight: "800", letterSpacing: -1, minWidth: 47 },
  headingTextWrap: { flex: 1, paddingTop: 3 },
  headingRule: { width: 28, height: 3, backgroundColor: COLORS.primary, borderRadius: 2, marginBottom: 7 },
  sectionTitle: { color: "#491B20", fontSize: 20, lineHeight: 24, fontWeight: "800", textTransform: "uppercase" },
  lead: { color: COLORS.primaryDark, fontSize: 16, lineHeight: 24, fontWeight: "700", marginBottom: 10 },
  body: { color: "#51494A", fontSize: 16, lineHeight: 24 },
  overline: { color: COLORS.primary, fontSize: 11, letterSpacing: 1.3, fontWeight: "800", marginTop: 20, marginBottom: 11 },
  pathList: { paddingLeft: 2 },
  pathItem: { flexDirection: "row", minHeight: 35 },
  pathRail: { width: 24, alignItems: "center" },
  pathDot: { width: 13, height: 13, borderWidth: 1.5, borderColor: COLORS.primaryLight, borderRadius: 7, backgroundColor: "#FFFDFC", zIndex: 1 },
  pathDotLast: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pathConnector: { width: 1.5, flex: 1, backgroundColor: "#F1A9AD", marginTop: -1 },
  pathText: { flex: 1, color: "#292426", fontSize: 14, lineHeight: 18, fontWeight: "700", paddingLeft: 5, paddingBottom: 12, textTransform: "uppercase" },
  pathTextLast: { color: COLORS.primaryDark },
  callout: { borderTopWidth: 3, borderTopColor: COLORS.primary, paddingTop: 13, marginTop: 9 },
  calloutText: { color: COLORS.primaryDark, fontSize: 16, lineHeight: 21, fontWeight: "800", textTransform: "uppercase" },
  redPanel: { backgroundColor: COLORS.primary, borderRadius: 18, paddingHorizontal: 19, paddingVertical: 23, marginBottom: 14, overflow: "hidden" },
  textOnRed: { color: "#FFF8F3" },
  headingRuleLight: { backgroundColor: "#FFC3C4" },
  leadLight: { color: "#FFF4F0", fontSize: 16, lineHeight: 24, fontWeight: "700", marginBottom: 10 },
  bodyLight: { color: "#FFE5E1", fontSize: 16, lineHeight: 24 },
  panelDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.46)", width: 52, marginVertical: 16 },
  panelStatement: { color: "#FFFFFF", fontSize: 16, lineHeight: 20, fontWeight: "800", textTransform: "uppercase" },
  sectionBreak: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.24)", marginTop: 27, paddingTop: 23 },
  panelStatementSmall: { color: "#FFFFFF", fontSize: 14, lineHeight: 19, fontWeight: "800", textTransform: "uppercase" },
  commitmentsBlock: { paddingHorizontal: 3, paddingTop: 12, paddingBottom: 7 },
  commitmentsKicker: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.15, marginBottom: 7 },
  commitmentsTitle: { color: "#40191D", fontSize: 23, lineHeight: 28, fontWeight: "800", textTransform: "uppercase", marginBottom: 16 },
  commitmentList: { borderTopWidth: 1, borderTopColor: "#EBCDD0" },
  commitment: { flexDirection: "row", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#EBCDD0" },
  commitmentNumber: { width: 48, color: COLORS.primary, fontSize: 22, lineHeight: 27, fontWeight: "800", letterSpacing: -0.7 },
  commitmentCopy: { flex: 1, borderLeftWidth: 1, borderLeftColor: "#E7A6AB", paddingLeft: 12 },
  commitmentTitle: { color: COLORS.primaryDark, fontSize: 15, lineHeight: 20, fontWeight: "800", textTransform: "uppercase", marginBottom: 4 },
  commitmentDetail: { color: "#554B4C", fontSize: 14, lineHeight: 22 },
  closingMark: { flexDirection: "row", alignItems: "center", marginTop: 17, alignSelf: "flex-end" },
  heartMark: { color: COLORS.primary, fontSize: 33, lineHeight: 36, fontWeight: "700", marginRight: 9 },
  closingText: { color: COLORS.primaryDark, fontSize: 13, fontWeight: "700" },
  leafletPanel: { backgroundColor: "#FCEAEC", borderRadius: 18, borderWidth: 1, borderColor: "#F3D1D4", padding: 19, marginTop: 8 },
  leafletKicker: { color: COLORS.primaryDark, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  leafletTitle: { color: "#4B1B20", fontSize: 23, lineHeight: 27, fontWeight: "800", textTransform: "uppercase", marginBottom: 9 },
  leafletBody: { color: "#574A4C", fontSize: 16, lineHeight: 24 },
  pillars: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, marginBottom: 12, gap: 7 },
  pillar: { backgroundColor: COLORS.primary, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7 },
  pillarText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  leafletDivider: { width: 40, height: 3, backgroundColor: COLORS.primary, marginTop: 17, marginBottom: 13 },
  leafletSubhead: { color: COLORS.primaryDark, fontSize: 17, lineHeight: 21, fontWeight: "800", textTransform: "uppercase", marginBottom: 8 },
  leafletPromise: { color: COLORS.primaryDark, fontSize: 16, lineHeight: 20, fontWeight: "800", textTransform: "uppercase", marginTop: 15 },
  leafletFooter: { color: "#6E4145", fontSize: 12, fontWeight: "700", marginTop: 14 },
  viewPagesButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "center",
    minHeight: 48, paddingHorizontal: 18, marginTop: 19, borderRadius: 24,
    borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: "#FFFDFC",
  },
  pressed: { opacity: 0.72 },
  viewPagesLabel: { color: COLORS.primaryDark, fontSize: 14, fontWeight: "800" },
  viewPagesArrow: { color: COLORS.primaryDark, fontSize: 17, marginLeft: 9, fontWeight: "700" },
  modalRoot: { flex: 1, backgroundColor: "#FFF8F6" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 17, paddingVertical: 14, borderBottomWidth: 1,
    borderBottomColor: "#EBCDD0", backgroundColor: "#FFFDFC",
  },
  modalEyebrow: { color: COLORS.primary, fontSize: 9, letterSpacing: 1.2, fontWeight: "800", marginBottom: 3 },
  modalTitle: { color: "#40191D", fontSize: 17, fontWeight: "800" },
  closeButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: 20, backgroundColor: COLORS.primary },
  closeButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  documentScroll: { flex: 1 },
  documentContent: { padding: 12, paddingBottom: 28, alignItems: "center" },
  documentPage: { width: "100%", maxWidth: 900, aspectRatio: 1024 / 683, marginBottom: 14, backgroundColor: "#F5E8E7" },
});
