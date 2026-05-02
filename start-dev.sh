#!/bin/bash
# Start both API server and frontend in parallel
PORT=8080 pnpm --filter @workspace/api-server run dev &
API_PID=$!

PORT=19591 BASE_PATH=/ pnpm --filter @workspace/dreamframe run dev &
FRONTEND_PID=$!

# Wait for either to exit (if one crashes, keep running until both done)
wait $API_PID $FRONTEND_PID
