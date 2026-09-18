const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

/*
  WORLDVIBE SECURE BACKEND

  Important:
  Real-money payment verification and creator payouts
  must be connected to a verified payment provider before
  any real money is credited.
*/


// =====================================================
// HEALTH CHECK
// =====================================================

exports.healthCheck = onCall(async (request) => {
  return {
    ok: true,
    service: "WorldVibe",
    message: "Backend is running."
  };
});


// =====================================================
// CREATE USER PROFILE
// =====================================================

exports.createUserProfile = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const uid = request.auth.uid;

  const userRef = db.collection("users").doc(uid);

  const existing = await userRef.get();

  if (!existing.exists) {

    await userRef.set({
      uid: uid,
      email: request.auth.token.email || "",
      displayName:
        request.auth.token.name ||
        "WorldVibe User",
      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
      coins: 0,
      earnings: 0,
      followers: [],
      following: []
    });
  }

  return {
    ok: true,
    uid: uid
  };
});


// =====================================================
// SECURE COIN BALANCE
// =====================================================

exports.getCoinBalance = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const uid = request.auth.uid;

  const userDoc =
    await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    return {
      coins: 0
    };
  }

  const data = userDoc.data() || {};

  return {
    coins:
      Number.isFinite(data.coins)
        ? data.coins
        : 0
  };
});


// =====================================================
// CREATOR EARNINGS
// =====================================================

exports.getCreatorEarnings = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const uid = request.auth.uid;

  const userDoc =
    await db.collection("users").doc(uid).get();

  if (!userDoc.exists) {
    return {
      coins: 0,
      earnings: 0
    };
  }

  const data = userDoc.data() || {};

  return {
    coins:
      Number.isFinite(data.coins)
        ? data.coins
        : 0,

    earnings:
      Number.isFinite(data.earnings)
        ? data.earnings
        : 0
  };
});


// =====================================================
// BUY COINS
// =====================================================

exports.createCoinPurchase = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const { packageId } = request.data || {};

  if (!packageId) {
    throw new HttpsError(
      "invalid-argument",
      "Package ID is required."
    );
  }

  /*
    IMPORTANT:

    Do NOT directly add coins here.

    A real payment provider must first confirm that
    the payment was successfully completed.

    After verified payment:
      payment provider webhook
            ↓
      secure backend
            ↓
      transaction
            ↓
      coins credited
  */

  return {
    ok: false,
    status: "payment_provider_required",
    message:
      "Payment provider verification must be connected before coins are credited."
  };
});


// =====================================================
// SEND GIFT
// =====================================================

exports.sendGift = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const senderUid = request.auth.uid;

  const {
    creatorUid,
    giftId,
    coins
  } = request.data || {};

  if (!creatorUid || !giftId) {
    throw new HttpsError(
      "invalid-argument",
      "Creator and gift are required."
    );
  }

  if (
    typeof coins !== "number" ||
    !Number.isInteger(coins) ||
    coins <= 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid coin amount."
    );
  }

  if (senderUid === creatorUid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot send a gift to yourself."
    );
  }

  const senderRef =
    db.collection("users").doc(senderUid);

  const creatorRef =
    db.collection("users").doc(creatorUid);

  await db.runTransaction(async (transaction) => {

    const senderSnap =
      await transaction.get(senderRef);

    const creatorSnap =
      await transaction.get(creatorRef);

    if (!senderSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Sender account not found."
      );
    }

    if (!creatorSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Creator account not found."
      );
    }

    const sender =
      senderSnap.data() || {};

    const creator =
      creatorSnap.data() || {};

    const senderCoins =
      Number(sender.coins || 0);

    if (senderCoins < coins) {
      throw new HttpsError(
        "failed-precondition",
        "Not enough coins."
      );
    }

    transaction.update(senderRef, {
      coins:
        senderCoins - coins
    });

    transaction.update(creatorRef, {
      earnings:
        Number(creator.earnings || 0) + coins
    });
  });

  return {
    ok: true,
    message: "Gift sent successfully."
  };
});


// =====================================================
// WITHDRAWAL REQUEST
// =====================================================

exports.requestWithdrawal = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const uid = request.auth.uid;

  const {
    amount,
    payoutMethod
  } = request.data || {};

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid withdrawal amount."
    );
  }

  if (!payoutMethod) {
    throw new HttpsError(
      "invalid-argument",
      "Payout method is required."
    );
  }

  const withdrawalRef =
    db.collection("withdrawalRequests").doc();

  await withdrawalRef.set({

    uid: uid,

    amount: amount,

    payoutMethod: payoutMethod,

    status: "pending",

    createdAt:
      admin.firestore.FieldValue.serverTimestamp()

  });

  return {
    ok: true,
    status: "pending",
    requestId: withdrawalRef.id,
    message:
      "Withdrawal request submitted for review."
  };
});


// =====================================================
// REPORT CONTENT
// =====================================================

exports.createReport = onCall(async (request) => {

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Login required."
    );
  }

  const uid = request.auth.uid;

  const {
    targetId,
    targetType,
    reason
  } = request.data || {};

  if (!targetId || !targetType || !reason) {
    throw new HttpsError(
      "invalid-argument",
      "Report information is incomplete."
    );
  }

  const reportRef =
    db.collection("reports").doc();

  await reportRef.set({

    reporterUid: uid,

    targetId: targetId,

    targetType: targetType,

    reason: reason,

    status: "open",

    createdAt:
      admin.firestore.FieldValue.serverTimestamp()

  });

  return {
    ok: true,
    reportId: reportRef.id
  };
});


// =====================================================
// NEW NOTIFICATION LOG
// =====================================================

exports.logNewNotification =
  onDocumentCreated(
    "users/{uid}/notifications/{notificationId}",
    async (event) => {

      if (!event.data) {
        return;
      }

      const notification =
        event.data.data() || {};

      console.log(
        "WorldVibe notification created:",
        notification
      );

      return null;
    }
  );