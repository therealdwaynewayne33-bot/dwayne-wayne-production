import { Router, type IRouter } from "express";
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
import generateSceneRouter from "./generate-scene";
import creditsRouter from "./credits";

const router: IRouter = Router();

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
router.use(generateSceneRouter);
router.use(creditsRouter);

export default router;
