import { type MintAccount, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "@memebot/solana";

/**
 * Evaluasi keamanan akun mint (docs/04 §4). Fungsi murni → mudah dites.
 * Gagal satu = fail. Extension yang dianggap aman: metadata/group pointer & data (dipakai pump.fun Token-2022).
 */

export interface MintVerdict {
  verdict: "pass" | "fail";
  reasons: string[];
  warnings: string[];
  program: "spl" | "token2022" | "unknown";
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
}

/** Extension yang aman/umum (tidak memberi kuasa atas token holder). */
const SAFE_EXTENSIONS = new Set([
  "metadataPointer",
  "tokenMetadata",
  "groupPointer",
  "tokenGroup",
  "groupMemberPointer",
  "tokenGroupMember",
  "immutableOwner",
  "mintCloseAuthority", // hanya bisa close mint saat supply 0
  "interestBearingConfig", // kosmetik (UI amount)
  "scaledUiAmountConfig",
]);

const isSet = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v !== "11111111111111111111111111111111";

export function checkMint(acc: MintAccount | null): MintVerdict {
  if (!acc) {
    return {
      verdict: "fail",
      reasons: ["mint_not_found"],
      warnings: [],
      program: "unknown",
      mintAuthority: null,
      freezeAuthority: null,
      extensions: [],
    };
  }
  const reasons: string[] = [];
  const warnings: string[] = [];
  const program =
    acc.owner === TOKEN_PROGRAM ? "spl" : acc.owner === TOKEN_2022_PROGRAM ? "token2022" : "unknown";
  if (program === "unknown") reasons.push(`unknown_token_program:${acc.owner}`);

  const { mintAuthority, freezeAuthority } = acc.info;
  if (mintAuthority) reasons.push("mint_authority_active");
  if (freezeAuthority) reasons.push("freeze_authority_active");

  const exts = acc.info.extensions ?? [];
  for (const e of exts) {
    const s = e.state ?? {};
    switch (e.extension) {
      case "permanentDelegate":
        if (isSet(s.delegate)) reasons.push("permanent_delegate");
        break;
      case "transferFeeConfig": {
        const newer = s.newerTransferFee as { transferFeeBasisPoints?: number } | undefined;
        const older = s.olderTransferFee as { transferFeeBasisPoints?: number } | undefined;
        const bps = Math.max(newer?.transferFeeBasisPoints ?? 0, older?.transferFeeBasisPoints ?? 0);
        if (bps > 0) reasons.push(`transfer_fee_${bps}bps`);
        else if (isSet(s.transferFeeConfigAuthority)) warnings.push("transfer_fee_authority_can_raise_fee");
        break;
      }
      case "transferHook":
        if (isSet(s.programId)) reasons.push("transfer_hook_active");
        else if (isSet(s.authority)) warnings.push("transfer_hook_authority_set");
        break;
      case "defaultAccountState":
        if (String(s.accountState ?? "").toLowerCase() === "frozen") reasons.push("default_account_frozen");
        break;
      case "nonTransferable":
        reasons.push("non_transferable");
        break;
      case "pausableConfig":
      case "pausable":
        if (s.paused === true) reasons.push("paused");
        if (isSet(s.authority)) reasons.push("pausable_authority");
        break;
      case "confidentialTransferMint":
        warnings.push("confidential_transfer");
        break;
      case "tokenMetadata":
        if (isSet(s.updateAuthority)) warnings.push("metadata_mutable");
        break;
      default:
        if (!SAFE_EXTENSIONS.has(e.extension)) reasons.push(`unknown_extension:${e.extension}`);
    }
  }

  return {
    verdict: reasons.length ? "fail" : "pass",
    reasons,
    warnings,
    program,
    mintAuthority,
    freezeAuthority,
    extensions: exts.map((e) => e.extension),
  };
}
