import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import charactersRouter from "./characters";
import projectsRouter from "./projects";
import videosRouter from "./videos";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(charactersRouter);
router.use(projectsRouter);
router.use(videosRouter);
router.use(dashboardRouter);

export default router;
