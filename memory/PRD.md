# PRD — Trivia GerabDevSoft

## Overview
Professional mobile trivia app (Android/iOS via Expo) where users answer multiple-choice questions, accumulate points, and participate in weekly raffles.

## Roles
- **Admin** (single, seeded as `admin@usfx.bo`, Google Sign-In only): Manages users, question bank, daily schedule, prizes, executes raffles, sends push notifications, views stats.
- **User**: Answers daily questions (once each), accumulates points (1 pt per correct answer, no penalty), views weekly Top-10 ranking, browses prizes, receives push notifications.

## Auth
- Google Sign-In only (Emergent Google OAuth). Admin role auto-granted to `admin@usfx.bo`.

## Features
1. **Question Bank**: CRUD with categories, activate/deactivate; each question has 1 correct + 3 incorrect options.
2. **Daily Schedule**: Admin selects X questions per day (default 5, configurable). Publishing sends push notification to all active users.
   - The count is locked for the current day before selection; publishing requires exactly that number, then opens the Published tab with the new entry.
3. **Answering**: Users can only answer once per question. Correct = +1 pt. Records daily/weekly/total points, correct/incorrect counts.
4. **Weekly Ranking**: Top 10 by weekly points. Updates dynamically per answer.
5. **Prizes**:
   - Type A "Weekly": Admin defines N, system picks top-N by weekly points, random winner among them.
   - Type B "Active Users": Random winner among users who answered ≥1 question in the period. One-shot execution (raffle marked as executed).
   - Images stored in MongoDB as binary. Deleting a prize deletes its image automatically.
6. **Raffle History**: Date, prize, participants, winner — persisted.
7. **Admin Dashboard**: Total users, active users, weekly participants, total answers, pending/executed prizes, Top-10 preview, upcoming prizes, manual push notifications.
8. **Push Notifications**: Native Android push through the configured Firebase project (`google-services.json`) and the push relay. Android 13+ requests permission after sign-in, displays foreground alerts, and never stores device tokens in MongoDB. Campaigns are sent in bulk from the admin panel; automatic messages trigger on schedule publication and raffle execution.
9. **Emails**: Resend (winner notifications). Placeholder key in dev.
10. **Design**: Blue (#002954/#0460c3/#00b8e2) + green (#57cc02) palette; watermark background (green paw pattern) on user screens; GerabDevSoft logo on login.

## Recent UX updates
- Admin and user data screens refresh when their tab gains focus and immediately after successful mutations (questions, prizes, raffles, dashboard, and weekly ranking).

## Tech
- Backend: FastAPI + Motor + MongoDB
- Frontend: Expo Router 6 + React Native 0.81
- Auth: Emergent OAuth (`session_token`) stored in expo-secure-store
- Push: Native notification runtime (`expo-notifications`) + push relay (native token via `getDevicePushTokenAsync`, never persisted locally)
- Email: Resend (production only with real key)

## Deployment Notes
- `frontend/google-services.json` is wired in `app.json` and its package matches `soft.dev.gerab.usfx.trivia`.
- `EMERGENT_PUSH_KEY` is auto-replaced by deployer.
- Push and email only work in native builds/production, NOT in Expo Go preview.
