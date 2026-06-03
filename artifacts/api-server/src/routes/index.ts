import { Router, type IRouter } from "express";
import { isBaselineMode } from "../lib/baseline-mode";
import healthRouter from "./health";
import authRouter from "./auth";
import charactersRouter from "./characters";
import projectsRouter from "./projects";
import videosRouter from "./videos";
import dashboardRouter from "./dashboard";
import billingRouter from "./billing";
import bgReplaceRouter from "./bg-replace";
import faceSwapRouter from "./face-swap";
import v2vRouter from "./v2v";
import colorGradeRouter from "./color-grade";
import generateSceneRouter from "./generate-scene";
import creditsRouter from "./credits";
import kontextColorRouter from "./kontext-color";
import kontextCinematicColorRouter from "./kontext-cinematic-color";
import productionRouter from "./production";
import aiSegmentTrackRouter from "./ai-segment-track";
import runwayGenerateRouter from "./runway-generate";
import stockImagesRouter from "./stock-images";
import stockVideosRouter from "./stock-videos";
import libraryRouter from "./library";

const router: IRouter = Router();

router.use((req, _res, next) => {
  if (isBaselineMode()) {
    const routeName = `${req.method} ${req.baseUrl}${req.path}`.replace(/\/+/g, "/");
    console.log(`[${routeName}] called - currently disconnected baseline`);
  }
  next();
});

router.use(healthRouter);
router.use(authRouter);
router.use(charactersRouter);
router.use(projectsRouter);
router.use(videosRouter);
router.use(dashboardRouter);
router.use(billingRouter);
router.use(bgReplaceRouter);
router.use(faceSwapRouter);
router.use(v2vRouter);
router.use(colorGradeRouter);
router.use(generateSceneRouter);
router.use(creditsRouter);
router.use(kontextColorRouter);
router.use(kontextCinematicColorRouter);
router.use(productionRouter);
router.use(aiSegmentTrackRouter);
router.use(runwayGenerateRouter);
router.use(stockImagesRouter);
router.use(stockVideosRouter);
router.use(libraryRouter);

export default router;
