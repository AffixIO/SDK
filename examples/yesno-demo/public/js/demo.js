/* Credit: @paparichens */
const proveForm = document.getElementById("prove-form");
const claimInput = document.getElementById("claim");
const requiredInput = document.getElementById("required");
const swapBtn = document.getElementById("swap-btn");
const proveStatus = document.getElementById("prove-status");
const decisionPanel = document.getElementById("decision-panel");
const decisionBadge = document.getElementById("decision-badge");
const proofDigest = document.getElementById("proof-digest");
const proofInput = document.getElementById("proof-input");
const verifyBtn = document.getElementById("verify-btn");
const copyBtn = document.getElementById("copy-btn");
const verifyStatus = document.getElementById("verify-status");
const verifyOutput = document.getElementById("verify-output");
const licenceBanner = document.getElementById("licence-banner");

let lastProof = "";
let lastEnvelope = null;

function showStatus(el, message, kind) {
  el.hidden = false;
  el.textContent = message;
  el.className = `status ${kind}`;
}

function hideStatus(el) {
  el.hidden = true;
  el.textContent = "";
  el.className = "status";
}

function setDecision(decision) {
  decisionPanel.hidden = false;
  decisionBadge.textContent = decision.toUpperCase();
  decisionBadge.className = `badge ${decision === "yes" ? "yes" : "no"}`;
}

function renderQuota(quota) {
  if (!quota || !licenceBanner) return;
  licenceBanner.hidden = false;
  const remaining = quota.remaining ?? 0;
  const limit = quota.limit ?? 0;
  const trial = quota.is_trial ? "Trial · " : "";
  licenceBanner.textContent = `${trial}${remaining} of ${limit} proofs remaining · tracked in Hub stats`;
  licenceBanner.className = "licence-banner ok";
}

async function loadHealth() {
  if (!licenceBanner) return;
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Health check failed");
    }
    if (data.quota) {
      renderQuota(data.quota);
      return;
    }
    licenceBanner.hidden = false;
    licenceBanner.textContent = data.licence?.message || "Licence active";
    licenceBanner.className = "licence-banner ok";
  } catch (err) {
    licenceBanner.hidden = false;
    licenceBanner.textContent = err.message || "Could not load licence status";
    licenceBanner.className = "licence-banner error";
  }
}

loadHealth();

proveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideStatus(proveStatus);

  const claim = claimInput.value.trim();
  const required = requiredInput.value.trim();

  try {
    const response = await fetch("/api/prove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, required }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Prove failed");
    }

    lastProof = data.proof;
    lastEnvelope = data.envelope ?? null;
    proofInput.value = data.proof;
    proofDigest.textContent = data.proof_digest || "—";
    setDecision(data.decision);
    copyBtn.disabled = !data.proof;

    showStatus(
      proveStatus,
      data.pass
        ? "Proof generated. Claim matches required."
        : "Proof generated. Claim does not match required.",
      "ok",
    );
    if (data.quota) {
      renderQuota(data.quota);
    }
  } catch (err) {
    showStatus(proveStatus, err.message || "Prove failed", "error");
  }
});

verifyBtn.addEventListener("click", async () => {
  hideStatus(verifyStatus);
  verifyOutput.hidden = true;

  const proof = proofInput.value.trim();
  if (!proof) {
    showStatus(verifyStatus, "Paste a proof hex first.", "error");
    return;
  }

  try {
    const body = { proof };
    if (lastEnvelope && proof === lastProof) {
      body.envelope = lastEnvelope;
    }

    const response = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Verify failed");
    }

    verifyOutput.hidden = false;
    verifyOutput.textContent = JSON.stringify(data, null, 2);

    showStatus(
      verifyStatus,
      data.valid
        ? `Valid proof. Decision: ${data.decision}.`
        : "Proof failed verification.",
      data.valid ? "ok" : "error",
    );
  } catch (err) {
    showStatus(verifyStatus, err.message || "Verify failed", "error");
  }
});

copyBtn.addEventListener("click", async () => {
  if (!lastProof) return;
  try {
    await navigator.clipboard.writeText(lastProof);
    showStatus(proveStatus, "Proof copied to clipboard.", "ok");
  } catch {
    showStatus(proveStatus, "Could not copy. Select the proof text manually.", "error");
  }
});

swapBtn.addEventListener("click", () => {
  claimInput.value = "approved";
  requiredInput.value = "denied";
  hideStatus(proveStatus);
});
