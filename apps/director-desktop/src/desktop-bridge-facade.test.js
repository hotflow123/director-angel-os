import { describe, expect, it, vi } from "vitest";

import { createDirectorDesktopBridgeFacade } from "./desktop-bridge-facade.js";
import { DESKTOP_ACTIONS, DESKTOP_TOOLS } from "./desktop-contract.js";

describe("director desktop bridge facade", () => {
  it("routes typed actions to injected system handlers", async () => {
    const handlers = {
      desktop: {
        pickDirectory: vi.fn(async () => ({ selectedDirectory: "/tmp/lessons", events: [] })),
      },
      snapshot: vi.fn(async () => result("snapshot")),
      command: {
        catalog: vi.fn(async () => ({ catalog: [], events: [] })),
        run: vi.fn(async (_action, dispatch) => dispatch({ type: DESKTOP_ACTIONS.SNAPSHOT })),
      },
      run: {
        continue: vi.fn(async () => result("run-continue")),
        delegations: vi.fn(async () => result("run-delegations")),
      },
      runtimeToolApproval: {
        decide: vi.fn(async () => result("runtime-tool-approval")),
      },
      liveAudio: {
        start: vi.fn(async () => result("live-audio-start")),
        stop: vi.fn(async () => result("live-audio-stop")),
        cancel: vi.fn(async () => result("live-audio-cancel")),
        status: vi.fn(async () => result("live-audio-status")),
      },
      settings: {
        set: vi.fn(async () => result("settings")),
        weixinGatewayControl: vi.fn(async () => result("weixin-gateway")),
        weixinGatewayAccountSelect: vi.fn(async () => result("weixin-account-select")),
        weixinGatewayLoginStart: vi.fn(async () => result("weixin-login-start")),
        weixinGatewayLoginPoll: vi.fn(async () => result("weixin-login-poll")),
      },
      experience: {
        accept: vi.fn(async () => result("accept")),
        promote: vi.fn(async () => result("promote")),
        update: vi.fn(async () => result("update")),
        createFromRunReport: vi.fn(async () => result("run-experience")),
        createFromTraceProposal: vi.fn(async () => result("trace-experience")),
      },
      skills: {
        classificationSave: vi.fn(async () => result("skill-classification")),
        enablementSet: vi.fn(async () => result("skill-enablement")),
        update: vi.fn(async () => result("skill-update")),
        delete: vi.fn(async () => result("skill-delete")),
        proposeFromExperience: vi.fn(async () => result("skill-propose")),
        proposalAccept: vi.fn(async () => result("skill-accept")),
        proposalReject: vi.fn(async () => result("skill-reject")),
        proposalApply: vi.fn(async () => result("skill-apply")),
      },
      soul: {
        list: vi.fn(async () => result("soul-list")),
        explain: vi.fn(async () => result("soul-explain")),
        accept: vi.fn(async () => result("soul-accept")),
        reject: vi.fn(async () => result("soul-reject")),
        view: vi.fn(async () => result("soul-view")),
      },
      heartbeat: {
        status: vi.fn(async () => result("heartbeat-status")),
        dailyReflection: vi.fn(async () => result("daily-reflection")),
      },
      maintenance: {
        preview: vi.fn(async () => result("maintenance-preview")),
        apply: vi.fn(async () => result("maintenance-apply")),
      },
      director: {
        plan: vi.fn(async () => result("director-plan")),
        planAccept: vi.fn(async () => result("director-plan-accept")),
        planIgnore: vi.fn(async () => result("director-plan-ignore")),
        planRerun: vi.fn(async () => result("director-plan-rerun")),
      },
    };
    const facade = createDirectorDesktopBridgeFacade({ handlers });

    await facade.invoke({ type: DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY });
    await facade.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT });
    await facade.invoke({ type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT, candidateId: "c1" });
    await facade.invoke({ type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE, candidateId: "c1" });
    await facade.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      candidateId: "c1",
      summary: "updated lesson",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId: "run-1",
      intent: "failure-lesson",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
      proposalId: "proposal-1",
      intent: "positive-experience",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId: "skill-1",
      categoryId: "coding",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: "skill-1",
      enabled: false,
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_UPDATE,
      skillId: "skill-1",
      title: "Updated Skill",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_DELETE,
      skillId: "skill-1",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
      candidateId: "experience-1",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      proposalId: "skill-proposal-1",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
      proposalId: "skill-proposal-2",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      proposalId: "skill-proposal-1",
    });
    await facade.invoke({ type: DESKTOP_ACTIONS.SOUL_LIST });
    await facade.invoke({ type: DESKTOP_ACTIONS.SOUL_EXPLAIN, candidateId: "soul-1" });
    await facade.invoke({ type: DESKTOP_ACTIONS.SOUL_ACCEPT, candidateId: "soul-1" });
    await facade.invoke({ type: DESKTOP_ACTIONS.SOUL_REJECT, candidateId: "soul-2" });
    await facade.invoke({ type: DESKTOP_ACTIONS.SOUL_VIEW });
    await facade.invoke({ type: DESKTOP_ACTIONS.HEARTBEAT_STATUS });
    await facade.invoke({ type: DESKTOP_ACTIONS.SELF_REFLECTION_DAILY, date: "2026-05-03" });
    await facade.invoke({ type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW });
    await facade.invoke({ type: DESKTOP_ACTIONS.MAINTENANCE_APPLY });
    await facade.invoke({ type: DESKTOP_ACTIONS.DIRECTOR_PLAN, prompt: "director plan" });
    await facade.invoke({
      type: DESKTOP_ACTIONS.DIRECTOR_PLAN_ACCEPT,
      decisionActionId: "accept_and_generate",
    });
    await facade.invoke({ type: DESKTOP_ACTIONS.DIRECTOR_PLAN_IGNORE });
    await facade.invoke({ type: DESKTOP_ACTIONS.DIRECTOR_PLAN_RERUN, prompt: "rerun director" });
    await facade.invoke({ type: DESKTOP_ACTIONS.RUN_CONTINUE, runId: "run-1" });
    await facade.invoke({ type: DESKTOP_ACTIONS.RUN_DELEGATIONS, runId: "run-1" });
    await facade.invoke({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: "tool:call-1",
      decision: "approve",
    });
    await facade.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_START, turnId: "turn-audio" });
    await facade.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_STATUS });
    await facade.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_STOP, reason: "done" });
    await facade.invoke({ type: DESKTOP_ACTIONS.LIVE_AUDIO_CANCEL, reason: "cancel" });
    await facade.invoke({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "feature:learning.enabled",
      value: true,
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      operation: "status",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT,
      accountId: "old-account",
    });
    await facade.invoke({ type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_START });
    await facade.invoke({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_POLL,
      verifyCode: "123456",
    });
    await facade.invoke({ type: DESKTOP_ACTIONS.COMMAND_CATALOG });
    await facade.invoke({ type: DESKTOP_ACTIONS.COMMAND_RUN, commandId: "desktop.snapshot" });

    expect(handlers.desktop.pickDirectory).toHaveBeenCalledTimes(1);
    expect(handlers.snapshot).toHaveBeenCalledTimes(2);
    expect(handlers.experience.accept).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateId: "c1",
    });
    expect(handlers.experience.promote).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
      candidateId: "c1",
    });
    expect(handlers.experience.update).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      candidateId: "c1",
      summary: "updated lesson",
    });
    expect(handlers.experience.createFromRunReport).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId: "run-1",
      intent: "failure-lesson",
    });
    expect(handlers.experience.createFromTraceProposal).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
      proposalId: "proposal-1",
      intent: "positive-experience",
    });
    expect(handlers.skills.classificationSave).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillId: "skill-1",
      categoryId: "coding",
    });
    expect(handlers.skills.enablementSet).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
      skillId: "skill-1",
      enabled: false,
    });
    expect(handlers.skills.update).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_UPDATE,
      skillId: "skill-1",
      title: "Updated Skill",
    });
    expect(handlers.skills.delete).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_DELETE,
      skillId: "skill-1",
    });
    expect(handlers.skills.proposeFromExperience).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
      candidateId: "experience-1",
    });
    expect(handlers.skills.proposalAccept).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      proposalId: "skill-proposal-1",
    });
    expect(handlers.skills.proposalReject).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
      proposalId: "skill-proposal-2",
    });
    expect(handlers.skills.proposalApply).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      proposalId: "skill-proposal-1",
    });
    expect(handlers.soul.list).toHaveBeenCalledWith({ type: DESKTOP_ACTIONS.SOUL_LIST });
    expect(handlers.soul.explain).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SOUL_EXPLAIN,
      candidateId: "soul-1",
    });
    expect(handlers.soul.accept).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SOUL_ACCEPT,
      candidateId: "soul-1",
    });
    expect(handlers.soul.reject).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SOUL_REJECT,
      candidateId: "soul-2",
    });
    expect(handlers.soul.view).toHaveBeenCalledWith({ type: DESKTOP_ACTIONS.SOUL_VIEW });
    expect(handlers.heartbeat.status).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
    });
    expect(handlers.heartbeat.dailyReflection).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SELF_REFLECTION_DAILY,
      date: "2026-05-03",
    });
    expect(handlers.maintenance.preview).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
    });
    expect(handlers.maintenance.apply).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
    });
    expect(handlers.director.plan).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.DIRECTOR_PLAN,
      prompt: "director plan",
    });
    expect(handlers.director.planAccept).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.DIRECTOR_PLAN_ACCEPT,
      decisionActionId: "accept_and_generate",
    });
    expect(handlers.director.planIgnore).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.DIRECTOR_PLAN_IGNORE,
    });
    expect(handlers.director.planRerun).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.DIRECTOR_PLAN_RERUN,
      prompt: "rerun director",
    });
    expect(handlers.run.continue).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.RUN_CONTINUE,
      runId: "run-1",
    });
    expect(handlers.run.delegations).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runId: "run-1",
    });
    expect(handlers.runtimeToolApproval.decide).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.RUNTIME_TOOL_APPROVAL_DECIDE,
      approvalId: "tool:call-1",
      decision: "approve",
    });
    expect(handlers.liveAudio.start).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_START,
      turnId: "turn-audio",
    });
    expect(handlers.liveAudio.status).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_STATUS,
    });
    expect(handlers.liveAudio.stop).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_STOP,
      reason: "done",
    });
    expect(handlers.liveAudio.cancel).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.LIVE_AUDIO_CANCEL,
      reason: "cancel",
    });
    expect(handlers.settings.set).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.SETTINGS_SET,
      parameterId: "feature:learning.enabled",
      value: true,
    });
    expect(handlers.settings.weixinGatewayControl).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      operation: "status",
    });
    expect(handlers.settings.weixinGatewayAccountSelect).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_ACCOUNT_SELECT,
      accountId: "old-account",
    });
    expect(handlers.settings.weixinGatewayLoginStart).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_START,
    });
    expect(handlers.settings.weixinGatewayLoginPoll).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_LOGIN_POLL,
      verifyCode: "123456",
    });
    expect(handlers.command.catalog).toHaveBeenCalledTimes(1);
    expect(handlers.command.run).toHaveBeenCalledTimes(1);
  });

  it("translates composer submit into a stable action id before dispatch", async () => {
    const learnDirectory = vi.fn(async () => result("learn"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        experience: {
          learnDirectory,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/tmp/learning-source",
      tool: DESKTOP_TOOLS.LEARN_DIRECTORY,
    });

    expect(learnDirectory).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: "/tmp/learning-source",
      sourceAction: {
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt: "/tmp/learning-source",
        tool: DESKTOP_TOOLS.LEARN_DIRECTORY,
        turnId: "desktop-workbench-turn-1",
        turnOrdinal: 1,
        sessionKey: "desktop:workbench",
        activeEvidenceFrame: null,
      },
    });
  });

  it("keeps workbench runtime history isolated by explicit desktop sessionKey", async () => {
    const text = vi.fn(async (action) => ({
      apiProviderRun: {
        ok: true,
        output: action.prompt,
      },
      conversationRuntime: {
        turnId: action.turnId,
        sessionKey: action.sessionKey,
        finalText: action.prompt,
        replySource: "model",
        transcriptMessages: [
          { role: "user", content: action.prompt },
          { role: "assistant", content: action.prompt },
        ],
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        experience: {
          learnUrl: vi.fn(async (action) => ({
            conversationRuntime: {
              turnId: action.turnId,
              sessionKey: action.sessionKey,
              finalText: "已学习旧链接",
              replySource: "structured-renderer",
              transcriptMessages: [
                { role: "user", content: action.source },
                { role: "assistant", content: "已学习旧链接" },
              ],
              evidenceDisclosure: {
                sources: [
                  {
                    url: action.source,
                    fullBodyChars: 120,
                    readStatus: "read",
                  },
                ],
              },
            },
            events: [],
          })),
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 会话第一句",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "B 会话第一句",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 会话第二句",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });

    expect(text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: "desktop:workbench:a",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: "desktop:workbench:b",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sessionKey: "desktop:workbench:a",
      }),
    );
    expect(JSON.stringify(text.mock.calls[2][0].sourceAction.runtimeHistory)).toContain(
      "A 会话第一句",
    );
    expect(JSON.stringify(text.mock.calls[2][0].sourceAction.runtimeHistory)).not.toContain(
      "B 会话第一句",
    );
  });

  it("keeps workbench active evidence frames isolated by explicit desktop sessionKey", async () => {
    const text = vi.fn(async (action) => ({
      apiProviderRun: {
        ok: true,
        output: action.prompt,
      },
      conversationRuntime: {
        turnId: action.turnId,
        sessionKey: action.sessionKey,
        finalText: action.prompt,
        replySource: "model",
        transcriptMessages: [
          { role: "user", content: action.prompt },
          { role: "assistant", content: action.prompt },
        ],
        evidenceDisclosure: {
          sources: [
            {
              url: action.prompt.includes("A")
                ? "https://example.com/a"
                : "https://example.com/b",
              fullBodyChars: 120,
              readStatus: "read",
            },
          ],
        },
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 学习",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "B 学习",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 追问",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "B 追问",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });

    const aFollowup = text.mock.calls.find((call) => call[0].prompt === "A 追问")?.[0];
    const bFollowup = text.mock.calls.find((call) => call[0].prompt === "B 追问")?.[0];
    expect(aFollowup?.activeEvidenceFrame).toMatchObject({
      sessionKey: "desktop:workbench:a",
      sourceUrls: ["https://example.com/a"],
    });
    expect(bFollowup?.activeEvidenceFrame).toMatchObject({
      sessionKey: "desktop:workbench:b",
      sourceUrls: ["https://example.com/b"],
    });
  });

  it("deletes a desktop workbench session context without touching other sessions", async () => {
    const text = vi.fn(async (action) => ({
      apiProviderRun: {
        ok: true,
        output: action.prompt,
      },
      conversationRuntime: {
        turnId: action.turnId,
        sessionKey: action.sessionKey,
        finalText: action.prompt,
        replySource: "model",
        transcriptMessages: [
          { role: "user", content: action.prompt },
          { role: "assistant", content: action.prompt },
        ],
        evidenceDisclosure: action.prompt.includes("学习")
          ? {
              sources: [
                {
                  url: "https://example.com/a",
                  fullBodyChars: 120,
                  readStatus: "read",
                },
              ],
            }
          : undefined,
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        experience: {
          learnUrl: vi.fn(async (action) => ({
            conversationRuntime: {
              turnId: action.sourceAction?.turnId ?? "learn-turn",
              sessionKey: action.sourceAction?.sessionKey,
              finalText: "已学习旧链接",
              replySource: "structured-renderer",
              transcriptMessages: [
                { role: "user", content: action.source },
                { role: "assistant", content: "已学习旧链接" },
              ],
              evidenceDisclosure: {
                sources: [
                  {
                    url: action.source,
                    fullBodyChars: 120,
                    readStatus: "read",
                  },
                ],
              },
            },
            events: [],
          })),
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习这个 https://example.com/a",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "B 会话第一句",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });
    const deleted = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 重新开始",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "B 继续",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });

    expect(deleted).toMatchObject({
      sessionDeleted: true,
      sessionKey: "desktop:workbench:a",
    });
    const restartedA = text.mock.calls.find((call) => call[0].prompt === "A 重新开始")?.[0];
    const continuedB = text.mock.calls.find((call) => call[0].prompt.includes("B 继续"))?.[0];
    expect(restartedA?.runtimeHistory).toBeUndefined();
    expect(restartedA?.activeEvidenceFrame).toBeNull();
    expect(JSON.stringify(continuedB?.sourceAction.runtimeHistory)).toContain(
      "B 会话第一句",
    );
    expect(JSON.stringify(continuedB?.sourceAction.runtimeHistory)).not.toContain(
      "https://example.com/a",
    );
  });

  it("archives a desktop workbench session transcript before deleting its context", async () => {
    const archiveSession = vi.fn(async (action) => ({
      sessionArchive: {
        ok: true,
        archiveId: "archive-a",
        path: "/tmp/archive-a.json",
        sessionKey: action.sessionKey,
      },
      events: [],
    }));
    const text = vi.fn(async (action) => ({
      apiProviderRun: {
        ok: true,
        output: action.prompt,
      },
      conversationRuntime: {
        turnId: action.turnId,
        sessionKey: action.sessionKey,
        finalText: action.prompt,
        replySource: "model",
        transcriptMessages: [
          { role: "user", content: action.prompt },
          { role: "assistant", content: `answer:${action.prompt}` },
        ],
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        composer: { archiveSession },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "A 会话第一句",
      surface: "workbench",
      sessionKey: "desktop:workbench:a",
    });
    const deleted = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
      sessionKey: "desktop:workbench:a",
    });

    expect(archiveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.COMPOSER_SESSION_DELETE,
        sessionKey: "desktop:workbench:a",
        archiveReason: "desktop-session-delete",
        transcriptArchive: expect.objectContaining({
          sessionKey: "desktop:workbench:a",
          runtimeHistory: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "A 会话第一句" }),
            expect.objectContaining({ role: "assistant", content: "answer:A 会话第一句" }),
          ]),
          turns: expect.arrayContaining([
            expect.objectContaining({ role: "user", text: "A 会话第一句" }),
          ]),
        }),
      }),
    );
    expect(deleted).toMatchObject({
      sessionDeleted: true,
      sessionArchive: {
        ok: true,
        archiveId: "archive-a",
        path: "/tmp/archive-a.json",
      },
    });
  });

  it("exposes unified runtime events for desktop conversation results", async () => {
    const text = vi.fn(async () => ({
      apiProviderRun: {
        ok: true,
        output: "OK",
      },
      conversationRuntime: {
        turnId: "desktop-workbench-turn-1",
        finalText: "OK",
        replySource: "model",
      },
      runtimeEvents: [
        {
          kind: "runtime.final",
          payload: { text: "OK" },
        },
      ],
      runtimeEventsV1: [
        {
          schemaVersion: "conversation-runtime.event.v1",
          kind: "turn.started",
          turnId: "desktop-workbench-turn-1",
          conversationId: "desktop:workbench",
          eventId: "desktop-workbench-turn-1:000001:turn.started",
          sequence: 1,
          startedAtMs: 1,
          occurredAtMs: 1,
          elapsedMs: 0,
          payload: {
            surface: "desktop",
          },
        },
      ],
      operatorTrace: [],
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "测试：只回复 OK，不要调用外部工具。",
      surface: "workbench",
    });

    expect(response.runtimeEventsV1).toEqual([
      expect.objectContaining({
        schemaVersion: "conversation-runtime.event.v1",
        kind: "turn.started",
      }),
    ]);
    expect(response.conversationRuntime.runtimeEventsV1).toEqual(response.runtimeEventsV1);
  });

  it("resets workbench conversation history and active evidence before the next composer turn", async () => {
    const text = vi.fn(async (action) => ({
      apiProviderRun: {
        ok: true,
        output: action.prompt,
      },
      conversationRuntime: {
        turnId: action.turnId,
        finalText: action.prompt,
        replySource: "model",
        transcriptMessages: [
          { role: "user", content: action.prompt },
          { role: "assistant", content: action.prompt },
        ],
        evidenceDisclosure: action.prompt.includes("学习")
          ? {
              sources: [
                {
                  url: "https://example.com/a",
                  fullBodyChars: 120,
                  readStatus: "read",
                },
              ],
            }
          : undefined,
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        experience: {
          learnUrl: vi.fn(async (action) => ({
            events: [],
            conversationRuntime: {
              turnId: action.turnId,
              finalText: "已学习旧链接",
              replySource: "structured-renderer",
              transcriptMessages: [
                { role: "user", content: action.source },
                { role: "assistant", content: "已学习旧链接" },
              ],
              evidenceDisclosure: {
                sources: [
                  {
                    url: action.source,
                    fullBodyChars: 120,
                    readStatus: "read",
                  },
                ],
              },
            },
          })),
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习这个 https://example.com/a",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_RESET,
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "测试：只回复 OK",
      surface: "workbench",
    });

    const secondTurnAction = text.mock.calls.at(-1)?.[0];
    expect(secondTurnAction.runtimeHistory).toBeUndefined();
    expect(secondTurnAction.activeEvidenceFrame).toBeNull();
  });

  it("routes composer cancel to the bridge turn controller", async () => {
    const cancel = vi.fn(() => ({
      cancelled: 2,
      events: [
        {
          role: "system",
          title: "已停止",
          body: "已停止 2 个执行。",
          actionType: "composer.cancel",
        },
      ],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        composer: {
          cancel,
        },
      },
    });

    const result = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-text-turn-lesson",
      reason: "operator stopped current composer turn",
    });

    expect(cancel).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.COMPOSER_CANCEL,
      turnId: "desktop-text-turn-lesson",
      reason: "operator stopped current composer turn",
    });
    expect(result).toMatchObject({ cancelled: 2 });
  });

  it("routes slash learning commands through native intent resolution", async () => {
    const learnUrl = vi.fn(async () => result("learn-url"));
    const learnDirectory = vi.fn(async () => result("learn-directory"));
    const learnQuery = vi.fn(async () => result("learn-query"));
    const learnText = vi.fn(async () => result("learn-text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnUrl,
          learnDirectory,
          learnQuery,
          learnText,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 https://example.com/lesson",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 /tmp/learning-source",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 剪辑节奏经验",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: [
        "/学习 AI短剧基础知识",
        "一、景别：大特写、特写、近景、中景。",
        "推荐流程：先确认画面目的，再选择景别、角度、构图、光影和运镜。",
      ].join("\n"),
      surface: "workbench",
    });

    expect(learnUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://example.com/lesson",
        privacy: "public",
      }),
    );
    expect(learnDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
        directory: "/tmp/learning-source",
        privacy: "confidential",
      }),
    );
    expect(learnQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY,
        query: "剪辑节奏经验",
        privacy: "public",
      }),
    );
    expect(learnText).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
        text: expect.stringContaining("推荐流程"),
        privacy: "internal",
      }),
    );
  });

  it("classifies desktop status questions before dispatching composer text actions", async () => {
    const text = vi.fn(async () => result("status"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "模型还是不能用吗",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我已经登录 X 了呀",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "刚才那个链接读到了吗？来源读取状态怎么样",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(3);
    expect(text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ desktopStatusIntent: "model_status_inquiry" }),
    );
    expect(text).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ desktopStatusIntent: "x_session_status_inquiry" }),
    );
    expect(text).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ desktopStatusIntent: "learning_source_inquiry" }),
    );
  });

  it("routes ordinary embedded URL reading prompts through model chat, not experience candidates", async () => {
    const learnUrl = vi.fn(async () => result("learn-url"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "deepseek-v3.2",
        output: "这是读取后的正文结论。",
      },
      events: [{ title: "模型调用完成", body: "这是读取后的正文结论。" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnUrl,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "别搜索，直接读取这个链接，然后只告诉我文章真正讲了什么 https://bcn5ot9wwnew.feishu.cn/wiki/KttewP2WqiWF0Bk8P68cAjTUnFh?from=from_copylink",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "学习这个 https://example.com/lesson?from=copy 但不要创建候选，不要说学到了，只告诉我结果",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "别搜索，直接读取这个微信公众号文章，只告诉我结果，不能创建候选：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      surface: "workbench",
    });

    expect(learnUrl).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(3);
    expect(text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "别搜索，直接读取这个链接，然后只告诉我文章真正讲了什么 https://bcn5ot9wwnew.feishu.cn/wiki/KttewP2WqiWF0Bk8P68cAjTUnFh?from=from_copylink",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "学习这个 https://example.com/lesson?from=copy 但不要创建候选，不要说学到了，只告诉我结果",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "别搜索，直接读取这个微信公众号文章，只告诉我结果，不能创建候选：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      }),
    );
  });

  it("keeps explicit URL persistence prompts on the experience candidate lane", async () => {
    const learnUrl = vi.fn(async () => result("learn-url"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnUrl,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把这个链接沉淀成经验 https://example.com/lesson?from=copy",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 请看 https://example.com/slash-lesson?from=copy",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(learnUrl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://example.com/lesson?from=copy",
        privacy: "public",
      }),
    );
    expect(learnUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://example.com/slash-lesson?from=copy",
        privacy: "public",
      }),
    );
  });

  it("routes plain natural URL learning prompts to the experience candidate lane", async () => {
    const learnUrl = vi.fn(async () => result("learn-url"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnUrl,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习这个链接：https://x.com/Adam38363368936/status/2056318384317620663",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习这个 https://x.com/Adam38363368936/status/2056318384317620663",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "根据宪法，学习这个 X 链接：https://x.com/Adam38363368936/status/2056318384317620663",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(learnUrl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://x.com/Adam38363368936/status/2056318384317620663",
        privacy: "public",
      }),
    );
    expect(learnUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://x.com/Adam38363368936/status/2056318384317620663",
        privacy: "public",
      }),
    );
    expect(learnUrl).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://x.com/Adam38363368936/status/2056318384317620663",
        privacy: "public",
      }),
    );
  });

  it("wires desktop task runtime actions to native handlers", async () => {
    const list = vi.fn(async () => result("task-runtime-list"));
    const read = vi.fn(async () => result("task-runtime-read"));
    const cancel = vi.fn(async () => result("task-runtime-cancel"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        taskRuntime: {
          list,
          read,
          cancel,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
      activeOnly: true,
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
      taskId: "desktop-live-run-session",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
      taskId: "desktop-live-run-session",
      reason: "operator stop",
    });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.TASK_RUNTIME_LIST,
        activeOnly: true,
      }),
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.TASK_RUNTIME_READ,
        taskId: "desktop-live-run-session",
      }),
    );
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.TASK_RUNTIME_CANCEL,
        taskId: "desktop-live-run-session",
        reason: "operator stop",
      }),
    );
  });

  it("extracts embedded local sources from learning prompts", async () => {
    const learnDirectory = vi.fn(async () => result("learn-directory"));
    const learnQuery = vi.fn(async () => result("learn-query"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnDirectory,
          learnQuery,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 /tmp/director-notes.md",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/学习 请看 file:///tmp/director%20lessons",
      surface: "workbench",
    });

    expect(learnDirectory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
        directory: "/tmp/director-notes.md",
        privacy: "confidential",
      }),
    );
    expect(learnDirectory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
        directory: "/tmp/director lessons",
        privacy: "confidential",
      }),
    );
    expect(learnQuery).not.toHaveBeenCalled();
  });

  it("does not turn casual sentences containing learning words into experience candidates", async () => {
    const learnQuery = vi.fn(async () => result("learn-query"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "闲聊回复",
      },
      events: [{ title: "模型调用完成", body: "闲聊回复" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnQuery,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我今天学习制作咖啡，挺开心",
      surface: "workbench",
    });

    expect(learnQuery).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "我今天学习制作咖啡，挺开心",
      }),
    );
    expect(response.apiProviderRun.output).toBe("闲聊回复");
  });

  it("keeps broad skill/api/settings questions in dynamic chat instead of hardcoded management templates", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "动态解释能力上下文",
      },
      events: [{ title: "模型调用完成", body: "动态解释能力上下文" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "skill 会怎么被调用？",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "api模型本身就配置好了，为什么不做完整",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "设置这块为什么看起来很复杂",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "外部工具应该怎么连接？",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "能不能查看 skill 是怎么被调用的？",
      surface: "workbench",
    });

    expect(commandRun).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(5);
    expect(text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "skill 会怎么被调用？",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "api模型本身就配置好了，为什么不做完整",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "设置这块为什么看起来很复杂",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "外部工具应该怎么连接？",
      }),
    );
    expect(text).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "能不能查看 skill 是怎么被调用的？",
      }),
    );
  });

  it("keeps desktop setup chat as short-term context and sends later learning requests through dynamic chat tools", async () => {
    const learnQuery = vi.fn(async () => result("learn-query"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "我会调用学习工具去处理这个搜索任务。",
      },
      events: [{ title: "模型调用完成", body: "dynamic" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnQuery,
        },
        apiProviders: {
          text,
        },
      },
    });

    const firstResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我最近想研究 seedance2.0 的短剧制作经验",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "现在去搜索微信公众号文章，学习这方面的制作经验",
      surface: "workbench",
    });

    expect(firstResponse.events[0]).toMatchObject({
      title: "Desktop context state",
      body: expect.stringContaining("Desktop context state:"),
    });
    expect(firstResponse.events[0].body).toContain("status: recorded");
    expect(firstResponse.events[0].body).not.toContain("我先把这句话");
    expect(learnQuery).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledOnce();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "现在去搜索微信公众号文章，学习这方面的制作经验。近期对话上下文：我最近想研究 seedance2.0 的短剧制作经验",
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          memoryDecision: expect.objectContaining({ action: "candidate-review" }),
          shouldInvokeRecall: true,
        }),
      }),
    );
  });

  it("routes natural X/Twitter learning research through dynamic chat tools, not experience candidates", async () => {
    const learnQuery = vi.fn(async () => result("learn-query"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      conversationRuntime: {
        turnId: "turn-x-learning",
        intent: { kind: "chat" },
        finalText: "我会先去 X/Twitter 取证，再告诉你学到了什么。",
        replySource: "tool-loop",
        transcriptMessages: [
          {
            role: "tool",
            toolCallId: "required-x-search",
            content: "status: needs-auth\nprovider: x-twitter",
            metadata: { toolName: "x_search" },
          },
        ],
      },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "我会先去 X/Twitter 取证，再告诉你学到了什么。",
      },
      events: [{ title: "工具调用完成", body: "x-search" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnQuery,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去学习推特学习最新的seedance 2.0经验",
      surface: "workbench",
    });

    expect(learnQuery).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "去学习推特学习最新的seedance 2.0经验",
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          memoryDecision: expect.objectContaining({ action: "candidate-review" }),
          shouldInvokeRecall: true,
        }),
      }),
    );
  });

  it("does not learn from bare natural language just because it contains learning and making words", async () => {
    const learnQuery = vi.fn(async () => result("learn-query"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "普通回复",
      },
      events: [{ title: "模型调用完成", body: "普通回复" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnQuery,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "学习制作咖啡挺开心",
      surface: "workbench",
    });

    expect(learnQuery).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "学习制作咖啡挺开心",
      }),
    );
  });

  it("routes slash review and system commands from the workbench composer", async () => {
    const accept = vi.fn(async () => result("accept"));
    const commandRun = vi.fn(async () => result("command"));
    const settingsSet = vi.fn(async () => result("settings"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            candidate: { id: "candidate-1", status: "pending" },
            assets: {
              settings: {
                parameters: [
                  {
                    id: "feature:learning.enabled",
                    label: "learning.enabled",
                    writable: true,
                  },
                ],
              },
            },
          }),
        ),
        command: {
          run: commandRun,
        },
        settings: {
          set: settingsSet,
        },
        experience: {
          accept,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/经验 接受",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具 注册 /tmp/adapter.json",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/设置",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/设置 learning.enabled 关闭",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/诊断",
      surface: "workbench",
    });

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
        candidateId: "candidate-1",
      }),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commandId: "adapter.list", args: {} }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        commandId: "adapter.register",
        args: { manifest: "/tmp/adapter.json" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ commandId: "workspace.switches", args: {} }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ commandId: "workspace.doctor", args: {} }),
      expect.any(Function),
    );
    expect(settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:learning.enabled",
        value: false,
      }),
    );
  });

  it("attaches shared turn operator trace to desktop-private slash routes", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具",
      surface: "workbench",
    });

    expect(commandRun).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "adapter.list",
        sourceAction: expect.objectContaining({
          type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
          prompt: "/工具",
        }),
      }),
      expect.any(Function),
    );
    expect(response.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "slash-command-detected" }),
        expect.objectContaining({ stage: "intent-decided" }),
      ]),
    );
    expect(response.events[0]).toMatchObject({
      title: "查看外部工具",
      body: expect.stringContaining("Desktop command state:"),
    });
    expect(response.events[0].body).toContain("status: parsed");
    expect(response.events[0].body).toContain("command: adapter.list");
    expect(response.events[0].body).not.toContain("Angel 会");
  });

  it("does not expose desktop action fallback prose when handlers return no events", async () => {
    const text = vi.fn(async () => ({ snapshot: { workspaceRoot: "/workspace" }, events: [] }));
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        production: { start: productionStart },
      },
    });

    const chatResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "随便聊一句",
      surface: "workbench",
    });
    const productionResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一条短剧分镜",
      surface: "workbench",
    });

    expect(chatResponse.events[0].body).toContain("Desktop model turn:");
    expect(chatResponse.events[0].body).not.toContain("Angel 会");
    expect(productionResponse.events[0].body).toContain("Desktop production state:");
    expect(productionResponse.events[0].body).not.toContain("Angel 会");
  });

  it("keeps explicit real-provider chat prompts on the model path even when they mention tools", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "deepseek-v3.2",
        output: "真实模型回执 DA-ROUTE-REAL",
      },
      events: [],
    }));
    const commandRun = vi.fn(async () => result("command"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        command: { run: commandRun },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "请通过当前已配置的模型供应方真实回答：用一行中文回复“真实模型回执 DA-ROUTE-REAL”，不要调用工具，不要解释。",
      surface: "workbench",
      turnId: "route-real-provider",
    });

    expect(commandRun).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "请通过当前已配置的模型供应方真实回答：用一行中文回复“真实模型回执 DA-ROUTE-REAL”，不要调用工具，不要解释。",
        sourceAction: expect.objectContaining({
          turnId: "route-real-provider",
          turnIntent: expect.objectContaining({ kind: "chat" }),
        }),
      }),
    );
  });

  it("routes provider slash commands to the API provider desktop action", async () => {
    const apiProviderSet = vi.fn(async () => result("provider"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          set: apiProviderSet,
        },
      },
    });

    const updatedBaseUrl = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 设置 memefast-api baseUrl https://proxy.example.test",
      surface: "workbench",
    });
    const updatedKey = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 密钥 memefast-api sk-real-secret",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 禁用 memefast-api",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/供应方 设置 memefast-api models gemini-2.5-flash,sora-2-pro",
      surface: "workbench",
    });

    expect(apiProviderSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_SET,
        providerId: "memefast-api",
        key: "baseUrl",
        value: "https://proxy.example.test",
      }),
    );
    expect(apiProviderSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_SET,
        providerId: "memefast-api",
        key: "apiKey",
        value: "sk-real-secret",
      }),
    );
    expect(apiProviderSet).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_SET,
        providerId: "memefast-api",
        key: "enabled",
        value: false,
      }),
    );
    expect(apiProviderSet).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_SET,
        providerId: "memefast-api",
        key: "models",
        value: "gemini-2.5-flash,sora-2-pro",
      }),
    );
    expect(updatedBaseUrl.events[0]).toMatchObject({
      title: "更新 API 供应方",
    });
    expect(updatedKey.events[0]).toMatchObject({
      title: "更新 API 供应方",
    });
  });

  it("routes ordinary workbench input to the real API provider text action", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "真实模型输出",
      },
      events: [{ title: "模型调用完成", body: "真实模型输出" }],
    }));
    const commandRun = vi.fn(async () => result("command"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "帮我写一句导演 Angel 的开场白",
      surface: "workbench",
    });

    expect(commandRun).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "帮我写一句导演 Angel 的开场白",
      }),
    );
    expect(response.apiProviderRun).toMatchObject({
      ok: true,
      output: "真实模型输出",
    });
    expect(response.events.map((event) => event.title)).toEqual(["模型调用完成"]);
  });

  it("forwards composer attachments to ordinary model turns", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        output: "真实模型输出",
      },
      events: [{ title: "模型调用完成", body: "真实模型输出" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "分析这个截图",
      surface: "workbench",
      attachments: [
        {
          id: "att-1",
          type: "file",
          path: "/Users/example/Desktop/capture.png",
          fileName: "capture.png",
        },
      ],
    });

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "分析这个截图",
        attachments: [
          {
            id: "att-1",
            type: "file",
            path: "/Users/example/Desktop/capture.png",
            fileName: "capture.png",
          },
        ],
      }),
    );
  });

  it("carries recent desktop context into ordinary follow-up model turns", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "真实模型输出",
      },
      events: [{ title: "模型调用完成", body: "真实模型输出" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "微信公众号搜索文章需要去搜狗里找的",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "那就执行",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(3);
    expect(text.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "那就执行。近期对话上下文：去微信公众号搜索相关seedance2.0的教程；微信公众号搜索文章需要去搜狗里找的",
      }),
    );
  });

  it("routes loose confirmation words to model chat when no review or run target is active", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: `模型回复：${action.prompt}`,
      },
      events: [{ title: "模型调用完成", body: `模型回复：${action.prompt}` }],
    }));
    const continueRun = vi.fn(async () => result("run-continue"));
    const accept = vi.fn(async () => result("accept"));
    const promote = vi.fn(async () => result("promote"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        run: {
          continue: continueRun,
        },
        experience: {
          accept,
          promote,
        },
        apiProviders: {
          text,
        },
      },
    });

    for (const prompt of ["确认", "继续", "执行", "确认执行，内容是：小猫从家里走到公园"]) {
      const response = await facade.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt,
        surface: "workbench",
      });

      expect(response.events[0].title).toBe("模型调用完成");
      expect(response.events[0].body).toContain(`模型回复：${prompt}`);
      expect(response.events[0].body).not.toContain("当前没有可确认继续的制作任务");
      expect(response.events[0].body).not.toContain("当前没有可继续的审查动作");
    }

    expect(text).toHaveBeenCalledTimes(4);
    expect(text).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "继续",
      }),
    );
    expect(continueRun).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
  });

  it("routes negative learning constraints to model chat instead of reject review actions", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: `模型回复：${action.prompt}`,
      },
      events: [{ title: "模型调用完成", body: `模型回复：${action.prompt}` }],
    }));
    const reject = vi.fn(async () => result("reject"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          reject,
        },
        apiProviders: {
          text,
        },
      },
    });

    for (const prompt of ["不要入库，只回答完整学到了什么", "先别保存，只总结这个链接"]) {
      const response = await facade.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt,
        surface: "workbench",
      });

      expect(response.events[0].title).toBe("模型调用完成");
      expect(response.events[0].body).toContain(`模型回复：${prompt}`);
      expect(response.events[0].body).not.toContain("当前没有可拒绝的候选");
    }

    expect(text).toHaveBeenCalledTimes(2);
    expect(reject).not.toHaveBeenCalled();
  });

  it("answers learning evidence detail follow-ups locally from the latest evidence disclosure", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: `模型回复：${action.prompt}`,
        evidenceDisclosure: {
          sources: [
            {
              url: "https://x.com/rionaifantasy/status/2055649954698551446",
              fullBodyChars: 5275,
              previewChars: 8000,
              secondPassExtracted: true,
              persisted: true,
              mediaUnderstood: false,
              readStatus: "已读到可信正文",
              sourceAccessStatus: "available",
              mediaInventory: {
                assetCount: 5,
                imageCount: 5,
                videoCount: 0,
                audioCount: 0,
                posterCount: 0,
                blobCount: 0,
              },
              mediaAdmission: {
                requiredNextAction: "request_user_authorization",
              },
            },
          ],
        },
      },
      events: [{ title: "模型调用完成", body: `模型回复：${action.prompt}` }],
    }));
    const reject = vi.fn(async () => result("reject"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            candidate: { id: "candidate-pending", status: "pending" },
          }),
        ),
        experience: {
          reject,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "请只读取并回答这个链接，不要入库：https://x.com/rionaifantasy/status/2055649954698551446",
      surface: "workbench",
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "看详情。请只基于刚才这个链接的学习结果，列出证据字段：URL、正文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否理解。",
      surface: "workbench",
    });

    expect(response.events[0].title).toBe("证据字段");
    expect(response.events[0].body).toContain(
      "URL：https://x.com/rionaifantasy/status/2055649954698551446",
    );
    expect(response.events[0].body).toContain("全文字符数：5275");
    expect(response.events[0].body).toContain("二次提取：是");
    expect(response.events[0].body).toContain("媒体数量：图片 5、视频 0、音频 0、poster 0、blob 0");
    expect(response.events[0].body).toContain("是否已入库：是");
    expect(response.events[0].body).toContain("媒体是否已理解：否");
    expect(response.events[0].body).toContain("文本已读，媒体未理解");
    expect(response.events[0].body).not.toContain("没有可执行的审查动作");
    expect(response.events[0].evidenceDisclosure).toBeDefined();

    expect(text).toHaveBeenCalledTimes(1);
    expect(reject).not.toHaveBeenCalled();
  });

  it("remembers snapshot-sourced evidence disclosures added by the final composer event", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      events: [{ title: "模型调用完成", body: `模型回复：${action.prompt}` }],
    }));
    const firstSnapshot = snapshotResult({
      assets: {
        tools: {
          taskRuntime: {
            latestTask: {
              status: "completed",
              updatedAt: Date.parse("2026-05-18T12:00:00.000Z"),
              payload: {
                evidenceDisclosure: {
                  sources: [
                    {
                      url: "https://x.com/example/status/1",
                      fullBodyChars: 0,
                      secondPassExtracted: false,
                      persisted: false,
                      mediaUnderstood: false,
                      readStatus: "未读到可信正文",
                      mediaInventory: {
                        imageCount: 0,
                        videoCount: 0,
                        audioCount: 0,
                        posterCount: 0,
                        blobCount: 0,
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
    const emptySnapshot = snapshotResult();
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(emptySnapshot);
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot,
        apiProviders: {
          text,
        },
      },
    });

    const firstResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "看详情。请只基于刚才这个链接的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；没读到正文时不要猜。",
      surface: "workbench",
    });

    expect(firstResponse.events[0].title).toBe("证据字段");

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "看详情。请只基于刚才这个链接的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；没读到正文时不要猜。",
      surface: "workbench",
    });

    expect(response.events[0].title).toBe("证据字段");
    expect(response.events[0].body).toContain("URL：https://x.com/example/status/1");
    expect(response.events[0].body).toContain("全文字符数：0");
    expect(response.events[0].body).toContain("媒体数量：图片 0、视频 0、音频 0、poster 0、blob 0");
    expect(response.events[0].body).toContain("媒体是否已理解：否");
    expect(text).not.toHaveBeenCalled();
  });

  it("answers evidence follow-ups from the latest task runtime evidence snapshot", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        output: `模型回复：${action.prompt}`,
      },
      events: [{ title: "模型调用完成", body: `模型回复：${action.prompt}` }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              tools: {
                taskRuntime: {
                  latestTask: {
                    status: "completed",
                    updatedAt: Date.parse("2026-05-18T12:00:00.000Z"),
                    payload: {
                      evidenceDisclosure: {
                        sources: [
                          {
                            url: "https://x.com/Adam38363368936/status/2056318384317620663",
                            fullBodyChars: 0,
                            secondPassExtracted: false,
                            persisted: false,
                            mediaUnderstood: false,
                            readStatus: "未读到可信正文",
                            mediaInventory: {
                              imageCount: 0,
                              videoCount: 0,
                              audioCount: 0,
                              posterCount: 0,
                              blobCount: 0,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "看详情。请只基于刚才这个链接的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；没读到正文时不要猜。",
      surface: "workbench",
    });

    expect(response.events[0].title).toBe("证据字段");
    expect(response.events[0].body).toContain(
      "URL：https://x.com/Adam38363368936/status/2056318384317620663",
    );
    expect(response.events[0].body).toContain("全文字符数：0");
    expect(response.events[0].body).toContain("二次提取：否");
    expect(response.events[0].body).toContain("是否已入库：否");
    expect(response.events[0].body).toContain("未读到可信正文，媒体未理解");
    expect(text).not.toHaveBeenCalled();
  });

  it("routes explicit read-only URL rereads through conversation runtime instead of production", async () => {
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      conversationRuntime: {
        turnId: "turn-x-reread",
        intent: action.sourceAction.turnIntent,
        finalText: "核心结论：六宫格故事板比九宫格更适合 AI 视频节奏。",
        replySource: "tool-loop",
        transcriptMessages: [],
      },
      apiProviderRun: {
        ok: true,
        providerId: "conversation-runtime",
        model: "runtime",
        output: "核心结论：六宫格故事板比九宫格更适合 AI 视频节奏。",
      },
      events: [{ title: "工具调用完成", body: "runtime" }],
    }));
    const productionStart = vi.fn(async () => result("production"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
        production: {
          start: productionStart,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "不要入库，只回答。请重新读取 https://x.com/ponyodong/status/2055150198989746559 并回答完整学到了什么。",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
            metadata: expect.objectContaining({
              directReadPreferred: true,
              sourceKind: "url",
              url: "https://x.com/ponyodong/status/2055150198989746559",
            }),
          }),
          shouldInvokeRecall: true,
          shouldCreateRun: false,
        }),
      }),
    );
  });

  it("routes fresh URL learning requests through the experience candidate lane instead of stale evidence snapshots", async () => {
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    const learnUrl = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      candidateIds: ["candidate-x"],
      evidenceDisclosure: {
        sources: [
          {
            url: xUrl,
            fullBodyChars: 1280,
            secondPassExtracted: true,
            persisted: false,
            mediaUnderstood: false,
          },
        ],
      },
      events: [{ title: "URL 学习", body: "已生成待审经验候选。全文字符数：1280" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              tools: {
                taskRuntime: {
                  latestTask: {
                    status: "completed",
                    updatedAt: Date.parse("2026-05-18T12:00:00.000Z"),
                    payload: {
                      evidenceDisclosure: {
                        sources: [
                          {
                            url: xUrl,
                            fullBodyChars: 0,
                            secondPassExtracted: false,
                            persisted: false,
                            mediaUnderstood: false,
                            readStatus: "未读到可信正文",
                            mediaInventory: {
                              imageCount: 0,
                              videoCount: 0,
                              audioCount: 0,
                              posterCount: 0,
                              blobCount: 0,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
        experience: {
          learnUrl,
        },
        apiProviders: { text },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `根据宪法，学习这个 X 链接：${xUrl}，使用 OpenCLI 当前 simon 登录态深读，输出结构化学习结论，并在证据区写清楚 URL、全文字符数、是否二次提取和媒体数量。`,
      surface: "workbench",
    });

    expect(response.events[0].title).toBe("URL 学习");
    expect(response.events[0].body).not.toContain("全文字符数：0");
    expect(text).not.toHaveBeenCalled();
    expect(learnUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: xUrl,
        privacy: "public",
      }),
    );
  });

  it("does not answer a fresh X URL learning request from stale evidence follow-up context", async () => {
    const xUrl = "https://x.com/Adam38363368936/status/2056318384317620663";
    const learnUrl = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      candidateIds: ["candidate-x"],
      events: [{ title: "URL 学习", body: "已重新读取并生成待审经验候选。" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              tools: {
                taskRuntime: {
                  latestTask: {
                    status: "completed",
                    updatedAt: Date.parse("2026-05-18T12:00:00.000Z"),
                    payload: {
                      evidenceDisclosure: {
                        sources: [
                          {
                            url: xUrl,
                            fullBodyChars: 0,
                            secondPassExtracted: false,
                            persisted: false,
                            mediaUnderstood: false,
                            readStatus: "未读到可信正文",
                            mediaInventory: {
                              imageCount: 0,
                              videoCount: 0,
                              audioCount: 0,
                              posterCount: 0,
                              blobCount: 0,
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
        experience: {
          learnUrl,
        },
        apiProviders: { text },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "看详情。请只基于刚才这个链接的学习结果，列出证据字段：URL、全文字符数、是否二次提取、图片/视频/音频/poster/blob 数量、是否已入库、媒体是否已理解；没读到正文时不要猜。",
      surface: "workbench",
    });

    const prompt = `根据宪法，学习这个 X 链接：${xUrl}，使用 OpenCLI 当前 simon 登录态深读，输出结构化学习结论，并在证据区写清楚 URL、全文字符数、是否二次提取、媒体数量、是否已入库、媒体是否已理解。`;
    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt,
      surface: "workbench",
    });

    expect(response.events[0].title).toBe("URL 学习");
    expect(response.events[0].body).not.toContain("全文字符数：0");
    expect(text).not.toHaveBeenCalled();
    expect(learnUrl).toHaveBeenCalledTimes(1);
    expect(learnUrl.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: xUrl,
      }),
    );
  });

  it("keeps search follow-ups in model/tool chat even when an old production run is actionable", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "已按上一轮要求继续搜狗微信搜索。",
      },
      events: [{ title: "模型调用完成", body: "search" }],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-stale-production",
                  status: "running",
                  goal: "制作一个小猫旅游记",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "去微信公众号搜索相关seedance2.0的教程",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "微信公众号搜索文章需要去搜狗里找的",
      surface: "workbench",
    });
    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "再去搜索看",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(3);
    expect(text.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "再去搜索看。近期对话上下文：去微信公众号搜索相关seedance2.0的教程；微信公众号搜索文章需要去搜狗里找的",
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          shouldAttachToActiveSession: false,
          shouldInvokeRecall: true,
        }),
      }),
    );
    expect(response.events[0]).toMatchObject({ title: "模型调用完成" });
  });

  it("keeps learning result follow-ups in model chat instead of continuing an active production run", async () => {
    const learnedUrl = "https://example.test/thread";
    const evidenceDisclosure = {
      schemaVersion: "director.desktop.evidence-disclosure.v1",
      sources: [
        {
          url: learnedUrl,
          fullBodyChars: 754,
          previewChars: 754,
          secondPassExtracted: false,
          persisted: false,
          readStatus: "read",
          sourceAccessStatus: "available",
          mediaUnderstood: false,
          mediaInventory: {
            assetCount: 2,
            imageCount: 1,
            videoCount: 1,
            audioCount: 0,
            posterCount: 0,
            blobCount: 0,
          },
        },
      ],
    };
    const learnUrl = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      candidateIds: ["candidate-learned-thread"],
      evidenceDisclosure,
      events: [
        {
          title: "URL 学习",
          body: "这个链接我看过了，已生成 1 条待审经验候选。",
          evidenceDisclosure,
        },
      ],
    }));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "deepseek-v3.2",
        output: "刚才学习的是一条关于资产图和角色生成流程的经验候选。",
      },
      events: [{ title: "模型调用完成", body: "学习结果" }],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        experience: {
          learnUrl,
        },
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `学习这个${learnedUrl}`,
      surface: "workbench",
    });
    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后学习了什么？",
      surface: "workbench",
    });

    expect(learnUrl).toHaveBeenCalledTimes(1);
    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: expect.stringContaining("然后学习了什么？"),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          shouldInvokeRecall: true,
          shouldCreateRun: false,
        }),
      }),
    );
    expect(response.events[0]).toMatchObject({ title: "模型调用完成" });
  });

  it("recovers latest pending learning evidence from snapshot so arbitrary follow-ups do not continue production", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "conversation-runtime",
        model: "runtime",
        output: "最近学习的是这条 X 链接里的资产图工作流。",
      },
      conversationRuntime: {
        evidenceDisclosure: action.activeEvidenceFrame.evidenceDisclosure,
      },
      events: [{ title: "模型调用完成", body: "最近学习的是这条 X 链接里的资产图工作流。" }],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-tanluai",
                    artifactId: "artifact-tanluai",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-tanluai"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "OpenCLI Twitter/X thread",
                  },
                ],
              },
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这到底讲的是啥",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        activeEvidenceFrame: expect.objectContaining({
          sourceUrls: [learnedUrl],
          candidateIds: ["experience-tanluai"],
          evidenceDisclosure: expect.objectContaining({
            sources: [expect.objectContaining({ url: learnedUrl })],
          }),
        }),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          shouldCreateRun: false,
        }),
      }),
    );
    expect(response.events[0]).toMatchObject({ title: "模型调用完成" });
  });

  it("does not recover another desktop session's pending learning evidence from snapshot", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const text = vi.fn(async () => result("model"));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-session-a",
                    artifactId: "artifact-session-a",
                    sessionKey: "desktop:workbench:a",
                    candidateIds: ["experience-session-a"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "Session A source",
                  },
                ],
              },
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后学习了什么？",
      surface: "workbench",
      sessionKey: "desktop:workbench:b",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(response.events.at(-1)).toMatchObject({
      title: "没有上一轮学习证据",
    });
    expect(response.events.at(-1)?.body).toContain("这次没有继续制作运行");
  });

  it("keeps bare continue prompts on the latest learning evidence instead of advancing an old production run", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const text = vi.fn(async (action) => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "conversation-runtime",
        model: "runtime",
        output: "继续基于刚才的学习证据回答：最有用的是提示词结构拆解。",
      },
      conversationRuntime: {
        finalText: "继续基于刚才的学习证据回答：最有用的是提示词结构拆解。",
        evidenceDisclosure: action.activeEvidenceFrame.evidenceDisclosure,
      },
      events: [
        {
          title: "模型调用完成",
          body: "继续基于刚才的学习证据回答：最有用的是提示词结构拆解。",
        },
      ],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-tanluai",
                    artifactId: "artifact-tanluai",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-tanluai"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "OpenCLI Twitter/X thread",
                  },
                ],
              },
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "继续",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        activeEvidenceFrame: expect.objectContaining({
          sourceUrls: [learnedUrl],
          candidateIds: ["experience-tanluai"],
        }),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
            metadata: expect.objectContaining({ followupKind: "learning-result" }),
          }),
          shouldCreateRun: false,
          shouldAttachToActiveSession: false,
        }),
      }),
    );
    expect(response.events[0]).toMatchObject({ title: "模型调用完成" });
  });

  it("fails closed on learning result follow-ups when evidence is missing instead of continuing production", async () => {
    const text = vi.fn(async () => result("model"));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后学习了什么？",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(response.events.at(-1)).toMatchObject({
      title: "没有上一轮学习证据",
    });
    expect(response.events.at(-1)?.body).toContain("没有找到上一轮学习证据");
    expect(response.events.at(-1)?.body).toContain("这次没有继续制作运行");
  });

  it("routes natural confirmation of the latest learned experience to learning confirmation runtime instead of production", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_779_200_060_000);
    const runContinue = vi.fn(async () => result("run-continue"));
    const text = vi.fn(async () => ({
      ...result("model"),
      conversationRuntime: {
        finalText: "已保存这条经验。已确认 1 条经验候选。",
        intent: { kind: "learning-confirmation" },
      },
      events: [
        {
          title: "学习确认",
          body: "已保存这条经验。已确认 1 条经验候选。",
        },
      ],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-tanluai",
                    artifactId: "artifact-tanluai",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-tanluai"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "OpenCLI Twitter/X thread",
                  },
                ],
              },
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把刚才学到的经验收录",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "把刚才学到的经验收录",
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-tanluai"],
          sourceUrls: [learnedUrl],
        }),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
          }),
          shouldCreateRun: false,
          shouldAttachToActiveSession: false,
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
    expect(text.mock.calls[0]?.[0].activeEvidenceFrame.frameId).toMatch(/^learn-1779200000000-/u);
    nowSpy.mockRestore();
  });

  it("keeps natural learning save confirmation valid after the active evidence frame TTL", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_779_200_360_001);
    const text = vi.fn(async () => ({
      ...result("confirmed"),
      conversationRuntime: {
        finalText: "已保存这条经验。已确认 1 条经验候选。",
        intent: { kind: "learning-confirmation" },
      },
      events: [{ title: "学习确认", body: "已保存这条经验。" }],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-expired",
                    artifactId: "artifact-expired",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-expired"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "Expired thread",
                  },
                ],
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把刚才学到的经验收录",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-expired"],
          sourceUrls: [learnedUrl],
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
    nowSpy.mockRestore();
  });

  it("fails closed on natural learning save confirmation when the pending candidate expired", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_779_200_360_001);
    const text = vi.fn(async () => result("model"));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-expired",
                    artifactId: "artifact-expired",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-expired"],
                    createdAtMs: 1_779_200_000_000,
                    expiresAtMs: 1_779_200_300_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "Expired thread",
                  },
                ],
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把刚才学到的经验收录",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-expired"],
          sourceUrls: [learnedUrl],
        }),
      }),
    );
    nowSpy.mockRestore();
  });

  it("binds ordinal learning save confirmation to the selected current candidate", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_779_200_060_000);
    const text = vi.fn(async () => ({
      ...result("confirmed"),
      conversationRuntime: {
        finalText: "已保存第 2 条经验。已确认 1 条经验候选。",
        intent: { kind: "learning-confirmation" },
      },
      events: [{ title: "学习确认", body: "已保存第 2 条经验。" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 2,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-two",
                    artifactId: "artifact-two",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-first", "experience-second"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: "https://example.test/two",
                    title: "Two candidates",
                  },
                ],
              },
            },
          }),
        ),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "收录第 2 条",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-first", "experience-second"],
          sourceUrls: ["https://example.test/two"],
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("第 2 条");
    nowSpy.mockRestore();
  });

  it("fails closed on natural learning save confirmation when no pending candidate exists", async () => {
    const text = vi.fn(async () => result("model"));
    const runContinue = vi.fn(async () => result("run-continue"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把刚才学到的经验收录",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "把刚才学到的经验收录",
      }),
    );
  });

  it("preserves learned candidate identity across evidence-only follow-ups before natural confirmation", async () => {
    const learnedUrl = "https://x.com/TanLuAI/status/2056949172629381407";
    const evidenceDisclosure = {
      schemaVersion: "director.desktop.evidence-disclosure.v1",
      sources: [
        {
          url: learnedUrl,
          fullBodyChars: 754,
          previewChars: 754,
          secondPassExtracted: false,
          persisted: false,
          readStatus: "read",
          sourceAccessStatus: "available",
          mediaUnderstood: false,
          mediaInventory: {
            assetCount: 3,
            imageCount: 3,
            videoCount: 0,
            audioCount: 0,
          },
        },
      ],
    };
    const learnUrl = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      candidateIds: ["experience-tanluai"],
      evidenceDisclosure,
      events: [
        {
          title: "URL 学习",
          body: "这个链接我看过了，已生成 1 条待审经验候选。",
          evidenceDisclosure,
        },
      ],
    }));
    const runContinue = vi.fn(async () => result("run-continue"));
    const text = vi
      .fn()
      .mockImplementationOnce(async (action) => ({
        ...result("followup"),
        conversationRuntime: {
          evidenceDisclosure: action.activeEvidenceFrame.evidenceDisclosure,
          finalText: "学到的是资产图和人设图的复用流程。",
        },
        events: [
          {
            title: "模型调用完成",
            body: "学到的是资产图和人设图的复用流程。",
            evidenceDisclosure: action.activeEvidenceFrame.evidenceDisclosure,
          },
        ],
      }))
      .mockImplementationOnce(async () => ({
        ...result("confirmed"),
        conversationRuntime: {
          finalText: "已保存这条经验。已确认 1 条经验候选。",
          intent: { kind: "learning-confirmation" },
        },
        events: [
          {
            title: "学习确认",
            body: "已保存这条经验。已确认 1 条经验候选。",
          },
        ],
      }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-actionable-production",
                  status: "running",
                  goal: "制作一个短剧蓝图",
                  assignments: [
                    {
                      assignmentId: "assignment-1",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        experience: {
          learnUrl,
        },
        run: {
          continue: runContinue,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: `学习这个 ${learnedUrl}`,
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后学习了什么？",
      surface: "workbench",
    });
    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把刚才学到的经验收录",
      surface: "workbench",
    });

    expect(runContinue).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(2);
    expect(text.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-tanluai"],
          sourceUrls: [learnedUrl],
          evidenceDisclosure,
        }),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
            metadata: expect.objectContaining({ learningConfirmation: true }),
          }),
          shouldCreateRun: false,
          shouldAttachToActiveSession: false,
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("已确认 1 条经验候选");
  });

  it("routes collection advice questions as learning follow-ups without confirming or rejecting", async () => {
    const learnedUrl = "https://x.com/AdrianPunk115/status/2056655062865490112";
    const text = vi.fn(async () => ({
      ...result("advice"),
      conversationRuntime: {
        finalText: "建议收录，最有用的是把中文字体提示词写具体。",
      },
      events: [
        {
          title: "模型调用完成",
          body: "建议收录，最有用的是把中文字体提示词写具体。",
        },
      ],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-adrian",
                    artifactId: "artifact-adrian",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-adrian"],
                    createdAtMs: 1_779_200_000_000,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "2026 文字类提示词设计指南",
                  },
                ],
              },
            },
          }),
        ),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这条要不要收录？哪些地方最有用？如果要收录，帮我提炼成一句可以进经验库的话。",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        activeEvidenceFrame: expect.objectContaining({
          candidateIds: ["experience-adrian"],
          sourceUrls: [learnedUrl],
        }),
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
            metadata: expect.objectContaining({ followupKind: "learning-result" }),
          }),
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("建议收录");
    expect(response.conversationRuntime.finalText).not.toContain("已取消保存");
    expect(response.events[0]).toMatchObject({
      title: "模型调用完成",
      body: expect.stringContaining("建议收录"),
    });
    expect(response.events[0].body).not.toContain("已取消保存");
  });

  it("routes save-value questions as learning follow-ups instead of save confirmations", async () => {
    const learnedUrl = "https://x.com/Xuhuicai888/status/2058393033880609001";
    const text = vi.fn(async () => ({
        ...result("value-points"),
        conversationRuntime: {
          finalText: "最值得保存的是安装路径、使用步骤、以及对后期剪辑的价值。",
        },
        events: [
          {
            title: "模型调用完成",
            body: "最值得保存的是安装路径、使用步骤、以及对后期剪辑的价值。",
          },
        ],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-hyperframes",
                    artifactId: "artifact-hyperframes",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-hyperframes"],
                    createdAtMs: 1_779_658_158_348,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "HyperFrames by HeyGen",
                  },
                ],
              },
            },
          }),
        ),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这条内容最值得保存的三点是什么？只基于刚才的学习内容回答。",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({
            kind: "chat",
            metadata: expect.objectContaining({ followupKind: "learning-result" }),
          }),
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("最值得保存");
    expect(response.conversationRuntime.finalText).not.toContain("证据字段");
    expect(response.conversationRuntime.finalText).not.toContain("已确认");
  });

  it("routes desktop capability questions to dynamic model-backed capability context", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "我会结合当前经验库、Skill、记忆和外部工具状态回答。",
      },
      events: [{ title: "模型调用完成", body: "动态能力回答" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "你具备什么能力？",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "你具备什么能力？",
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "capability-intro" }),
          memoryDecision: expect.objectContaining({ action: "never-store" }),
        }),
      }),
    );
    expect(response.apiProviderRun).toMatchObject({
      ok: true,
      output: "我会结合当前经验库、Skill、记忆和外部工具状态回答。",
    });
    expect(response.events[0]).toMatchObject({
      title: "模型调用完成",
    });
    expect(response.responsePolicy).toBe("control-reply");
    expect(response.memoryDecision).toMatchObject({ action: "never-store" });
  });

  it("keeps capability questions with a pending learning candidate out of learning confirmation", async () => {
    const learnedUrl = "https://x.com/Xuhuicai888/status/2058393033880609001";
    const text = vi.fn(async () => ({
      ...result("capability"),
      conversationRuntime: {
        finalText: "可以，接入 CLI 后我会按你的授权边界操作。",
        intent: { kind: "chat" },
      },
      events: [{ title: "模型调用完成", body: "可以，接入 CLI 后我会按你的授权边界操作。" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              learning: {
                pendingConfirmationCount: 1,
                pendingConfirmations: [
                  {
                    confirmationId: "confirm-hyperframes",
                    artifactId: "artifact-hyperframes",
                    sessionKey: "desktop:workbench",
                    candidateIds: ["experience-hyperframes"],
                    createdAtMs: 1_779_658_158_348,
                    sourceKind: "url",
                    sourceRef: learnedUrl,
                    title: "HyperFrames by HeyGen",
                  },
                ],
              },
            },
          }),
        ),
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "如果我给你你接入HyperFrames的cli，你可以操作吗",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(text.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "如果我给你你接入HyperFrames的cli，你可以操作吗",
        sourceAction: expect.objectContaining({
          turnIntent: expect.not.objectContaining({
            metadata: expect.objectContaining({ learningConfirmation: true }),
          }),
        }),
      }),
    );
    expect(response.conversationRuntime.finalText).toContain("接入 CLI");
    expect(response.conversationRuntime.finalText).not.toContain("已保存这条经验");
  });

  it("does not start production from loose supplement wording without an active run", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "普通对话输出",
      },
      events: [{ title: "模型调用完成", body: "普通对话输出" }],
    }));
    const productionStart = vi.fn(async () => result("production"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        production: {
          start: productionStart,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "不要回复太长",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "主题：小猫去公园",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledTimes(2);
  });

  it("routes conversational continue prompts to the next real run approval action", async () => {
    const commandRun = vi.fn(async () => result("run-approval"));
    const continueRun = vi.fn(async () => result("run-continue"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                executionItems: [
                  {
                    runId: "run-production-1",
                    status: "running",
                    goal: "生成一个15秒短剧分镜蓝图",
                    assignments: [
                      {
                        assignmentId: "assignment-script",
                        status: "pending",
                        approvalMode: "operator_approve",
                      },
                    ],
                  },
                ],
              },
            },
          }),
        ),
        command: {
          run: commandRun,
        },
        run: {
          continue: continueRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "继续",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(commandRun).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: "run-production-1",
      }),
    );
    expect(response.events[0]).toMatchObject({
      title: "批准待审制作任务",
    });

    continueRun.mockClear();
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "然后补充一下，小猫在公园遇到朋友",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(commandRun).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: "run-production-1",
      }),
    );
  });

  it("answers next-step questions from the snapshot without falling back to model chat", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                executionItems: [
                  {
                    runId: "run-production-2",
                    status: "created",
                    goal: "生成短剧分镜",
                    assignmentCounts: { pending: 3, ready: 0, completed: 0, failed: 0 },
                    assignments: [],
                  },
                ],
              },
            },
          }),
        ),
        command: {
          run: commandRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我该做什么",
      surface: "workbench",
    });

    expect(commandRun).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(response.events[0]).toMatchObject({
      title: "下一步建议",
    });
    expect(response.events[0].body).toContain("/运行 继续 run-production-2");
  });

  it("routes approval language to the current pending run instead of generic review queues", async () => {
    const commandRun = vi.fn(async () => result("approve-all"));
    const continueRun = vi.fn(async () => result("run-continue"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-production-3",
                  status: "running",
                  assignments: [
                    {
                      assignmentId: "assignment-shot",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        command: {
          run: commandRun,
        },
        run: {
          continue: continueRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "把当前待审任务都通过",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(commandRun).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: "run-production-3",
      }),
    );
  });

  it("treats channel confirmation language as continuing the current pending run", async () => {
    const continueRun = vi.fn(async () => result("run-continue"));
    const productionStart = vi.fn(async () => result("production"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () =>
          snapshotResult({
            assets: {
              review: {
                latestRun: {
                  runId: "run-production-4",
                  status: "running",
                  assignments: [
                    {
                      assignmentId: "assignment-script",
                      status: "pending",
                      approvalMode: "operator_approve",
                    },
                  ],
                },
              },
            },
          }),
        ),
        production: {
          start: productionStart,
        },
        run: {
          continue: continueRun,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "确认执行，内容是：小猫从家里走到公园",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(continueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.RUN_CONTINUE,
        runId: "run-production-4",
      }),
    );
  });

  it("learns linked material first when a mixed learn-and-make prompt includes a URL", async () => {
    const learnUrl = vi.fn(async () => result("learn-url"));
    const productionStart = vi.fn(async () => result("production"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          learnUrl,
        },
        production: {
          start: productionStart,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "先学习这个资料再做短剧 https://example.com/director-guide",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(learnUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
        url: "https://example.com/director-guide",
      }),
    );
    expect(response.events[0].body).toContain("学习完成后");
  });

  it("routes granular natural language experience operations to their concrete actions", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const categoryCreate = vi.fn(async () => result("category"));
    const classificationSave = vi.fn(async () => result("classification"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
        experience: {
          categoryCreate,
          classificationSave,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "解释经验 candidate-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "新建经验分类 镜头语言",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "给经验 candidate-42 分类 director-production 标签 shot-language lighting",
      surface: "workbench",
    });

    expect(commandRun).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "experience.explain",
        args: { candidateId: "candidate-42" },
      }),
      expect.any(Function),
    );
    expect(categoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE,
        name: "镜头语言",
      }),
    );
    expect(classificationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
        candidateId: "candidate-42",
        categoryId: "director-production",
        tagIds: ["shot-language", "lighting"],
      }),
    );
  });

  it("routes granular natural language knowledge and run operations to concrete commands", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "查看知识包 pack-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "查看 run-1 的报告",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "重试 run-1 assignment-1",
      surface: "workbench",
    });

    expect(commandRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        commandId: "knowledge.explain",
        args: { packId: "pack-42" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        commandId: "run.report",
        args: { runId: "run-1" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        commandId: "run.retry",
        args: { runId: "run-1", assignmentId: "assignment-1" },
      }),
      expect.any(Function),
    );
  });

  it("routes granular natural language heartbeat and provider checks to safe desktop actions", async () => {
    const status = vi.fn(async () => result("heartbeat"));
    const apiProviderTest = vi.fn(async () => result("provider-test"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        heartbeat: {
          status,
        },
        apiProviders: {
          test: apiProviderTest,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "检查心跳状态",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "测试供应方 memefast-api",
      surface: "workbench",
    });

    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      }),
    );
    expect(apiProviderTest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
        providerId: "memefast-api",
      }),
    );
  });

  it("keeps ordinary API connectivity chat on the configured model instead of provider management", async () => {
    const apiProviderTest = vi.fn(async () => result("provider-test"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-3-flash-preview",
        output: "真实 API 连通测试成功，万事如意。",
      },
      events: [{ title: "模型调用完成", body: "真实 API 连通测试成功，万事如意。" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          test: apiProviderTest,
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "用一句话回答：真实 API 连通测试成功，并顺手说一个四字成语。",
      surface: "workbench",
    });

    expect(apiProviderTest).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "用一句话回答：真实 API 连通测试成功，并顺手说一个四字成语。",
      }),
    );
    expect(response.apiProviderRun.output).toContain("万事如意");
  });

  it("routes shared channel slash commands that are not local slash names", async () => {
    const apiProviderTest = vi.fn(async () => result("provider-test"));
    const snapshot = vi.fn(async () => snapshotResult());
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot,
        apiProviders: {
          test: apiProviderTest,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/模型供应方",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/测试供应方 memefast-api",
      surface: "workbench",
    });

    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(apiProviderTest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEST,
        providerId: "memefast-api",
      }),
    );
  });

  it("routes production prompts to production.start instead of the API provider text action", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: {
        ok: true,
        prompt: "导演制作：backend snapshot continuity teaser 短剧",
        runId: "run-production-1",
        skillIds: ["skill.backend-snapshot"],
        knowledgePackIds: ["director-experience-local-constraints"],
      },
      events: [{ title: "制作任务已创建", body: "run run-production-1" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        production: {
          start: productionStart,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "导演制作：backend snapshot continuity teaser 短剧",
      surface: "workbench",
      sessionKey: "desktop:workbench:production-a",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一条 backend snapshot 导演制作短剧",
      surface: "workbench",
      sessionKey: "desktop:workbench:production-b",
    });

    expect(text).not.toHaveBeenCalled();
    expect(productionStart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "导演制作：backend snapshot continuity teaser 短剧",
        sessionKey: "desktop:workbench:production-a",
        createRun: true,
      }),
    );
    expect(productionStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "生成一条 backend snapshot 导演制作短剧",
        sessionKey: "desktop:workbench:production-b",
        createRun: true,
      }),
    );
  });

  it("does not fabricate production final text when the production action has no model output", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: {
        ok: true,
        runId: "run-no-output",
        runStatus: "created",
        modelDraft: {
          ok: false,
          message: "制作草案模型层不可用：provider not configured",
        },
      },
      events: [],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        production: {
          start: productionStart,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一条测试短剧",
      surface: "workbench",
    });

    expect(JSON.stringify(response)).not.toContain("制作结果已生成");
    expect(response.conversationRuntime).toMatchObject({
      finalText: undefined,
      replySource: "degraded-error",
    });
    expect(response.runtimeEvents.some((event) => event.kind === "runtime.final")).toBe(false);
    expect(response.runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.error",
          payload: expect.objectContaining({
            code: "production_final_unavailable",
          }),
        }),
      ]),
    );
  });

  it("routes production workbench input to the Director production action", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: {
        ok: true,
        skillStatus: "hit",
        recallStatus: "hit",
        runId: "run-1",
      },
      events: [{ title: "制作任务已创建", body: "run run-1" }],
    }));
    const text = vi.fn(async () => result("text"));
    const image = vi.fn(async () => result("image"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
          image,
        },
        production: {
          start: productionStart,
        },
      },
    });

    const slashResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/制作 生成一个 15 秒短剧分镜蓝图",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/生成 一条小猫旅行短片",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "请帮我规划一个短剧制作蓝图",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "按上次那个风格继续",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我制作一个小猫旅游记",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    expect(productionStart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "生成一个 15 秒短剧分镜蓝图",
        createRun: true,
      }),
    );
    expect(productionStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "一条小猫旅行短片",
        createRun: true,
      }),
    );
    expect(productionStart).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "请帮我规划一个短剧制作蓝图",
        createRun: true,
      }),
    );
    expect(productionStart).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: expect.stringContaining("按上次那个风格继续"),
        createRun: true,
      }),
    );
    expect(productionStart.mock.calls[3][0].prompt).toContain("15 秒短剧分镜蓝图");
    expect(productionStart).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "制作一个小猫旅游记",
        createRun: true,
      }),
    );
    expect(slashResponse.productionRun).toMatchObject({
      ok: true,
      runId: "run-1",
    });
    expect(slashResponse.events.map((event) => event.title)).toEqual(["制作任务已创建"]);
    expect(slashResponse.operatorTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "channel",
          stage: "channel.ingest",
          detail: "director-desktop-workbench:done",
        }),
        expect.objectContaining({
          source: "runtime",
          stage: "production.dispatched",
        }),
      ]),
    );
  });

  it("keeps explicit AI production consultation prompts in model chat without creating tasks", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: { ok: true, runId: "run-should-not-start" },
      events: [{ title: "制作任务已创建", body: "run run-should-not-start" }],
    }));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "gemini-2.5-flash",
        output: "优先比较：角色一致性、镜头可控性、图生视频稳定性。",
      },
      events: [{ title: "模型调用完成", body: "consultation" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: { text },
        production: { start: productionStart },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "别创建任何任务。我问的是咨询问题：2026年做AI短剧时，先生成分镜图再生视频，应该优先比较哪些能力维度？只用三点回答。",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "别创建任何任务。我问的是咨询问题：2026年做AI短剧时，先生成分镜图再生视频，应该优先比较哪些能力维度？只用三点回答。",
        sourceAction: expect.objectContaining({
          turnIntent: expect.objectContaining({ kind: "chat" }),
          shouldCreateRun: false,
          shouldAttachToActiveSession: false,
        }),
      }),
    );
    expect(response.events[0]).toMatchObject({ title: "模型调用完成" });
  });

  it("uses short-term desktop context when a later production prompt refers back", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: {
        ok: true,
        runId: "run-context-production",
      },
      events: [{ title: "制作任务已创建", body: "run run-context-production" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
        production: {
          start: productionStart,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "我最近想研究 seedance2.0 的短剧制作经验",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "按这个做一个15秒短剧分镜",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(productionStart).toHaveBeenCalledOnce();
    const prompt = productionStart.mock.calls[0][0].prompt;
    expect(prompt).toContain("按这个做一个15秒短剧分镜");
    expect(prompt).toContain("seedance2.0");
    expect(prompt).toContain("短剧制作经验");
  });

  it("routes script and copywriting slash input through production workflow types", async () => {
    const productionStart = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      productionRun: {
        ok: true,
        runId: "run-typed-production",
      },
      events: [{ title: "制作任务已创建", body: "run run-typed-production" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          text,
        },
        production: {
          start: productionStart,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/脚本 写一个小猫从家走到公园的治愈故事",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/文案 给公园咖啡车写短视频口播",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(productionStart).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "写一个小猫从家走到公园的治愈故事",
        createRun: true,
        workflowType: "script",
      }),
    );
    expect(productionStart).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.PRODUCTION_START,
        prompt: "给公园咖啡车写短视频口播",
        createRun: true,
        workflowType: "copywriting",
      }),
    );
  });

  it("routes ComfyUI open interface requests without submitting a workflow", async () => {
    const open = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      comfyUiOpen: {
        ok: true,
        url: "http://127.0.0.1:8188",
      },
      events: [{ title: "ComfyUI 界面已打开", body: "http://127.0.0.1:8188" }],
    }));
    const run = vi.fn(async () => result("comfyui-run"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        comfyui: {
          open,
          run,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/comfyui 打开界面",
      surface: "workbench",
    });

    expect(run).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.COMFYUI_OPEN,
      }),
    );
    expect(response.comfyUiOpen).toMatchObject({
      ok: true,
      url: "http://127.0.0.1:8188",
    });
  });

  it("routes ComfyUI script workflow creation without submitting a smoke workflow", async () => {
    const createWorkflow = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      comfyUiWorkflow: {
        ok: true,
        workflowKind: "script",
        objective: "一个小猪学习游泳的30秒故事",
      },
      events: [{ title: "ComfyUI 工作流草案已创建" }],
    }));
    const run = vi.fn(async () => result("comfyui-run"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        comfyui: {
          createWorkflow,
          run,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本 一个小猪学习游泳的30秒故事",
      surface: "workbench",
    });

    expect(run).not.toHaveBeenCalled();
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comfyui.createWorkflow",
        workflowKind: "script",
        objective: "一个小猪学习游泳的30秒故事",
      }),
    );
    expect(response.comfyUiWorkflow).toMatchObject({
      ok: true,
      workflowKind: "script",
      objective: "一个小猪学习游泳的30秒故事",
    });
  });

  it("routes ComfyUI combined script image video workflow creation with explicit modes", async () => {
    const createWorkflow = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      comfyUiWorkflow: {
        ok: true,
        workflowKind: "script",
        workflowModes: ["script", "image", "video"],
        objective: "一个小猪学习游泳的30秒故事",
      },
      events: [{ title: "ComfyUI 完整工作流已创建" }],
    }));
    const run = vi.fn(async () => result("comfyui-run"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        comfyui: {
          createWorkflow,
          run,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/ComfyUI 脚本+图片+视频 一个小猪学习游泳的30秒故事",
      surface: "workbench",
    });

    expect(run).not.toHaveBeenCalled();
    expect(createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "comfyui.createWorkflow",
        workflowKind: "script",
        workflowModes: ["script", "image", "video"],
        objective: "一个小猪学习游泳的30秒故事",
      }),
    );
    expect(response.comfyUiWorkflow).toMatchObject({
      workflowModes: ["script", "image", "video"],
      objective: "一个小猪学习游泳的30秒故事",
    });
  });

  it("routes image requests to the real API provider image action", async () => {
    const image = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderImage: {
        ok: true,
        providerId: "memefast-api",
        model: "gpt-image-2",
        endpoint: "https://proxy.example.test/v1/images/generations",
        images: [{ url: "https://cdn.example.test/angel.png" }],
      },
      events: [{ title: "图片生成完成", body: "https://cdn.example.test/angel.png" }],
    }));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          image,
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "生成图片：电影感导演工作台",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(image).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_IMAGE,
        prompt: "电影感导演工作台",
      }),
    );
    expect(response.apiProviderImage).toMatchObject({
      ok: true,
      images: [{ url: "https://cdn.example.test/angel.png" }],
    });
    expect(response.events.map((event) => event.title)).toEqual(["图片生成完成"]);
  });

  it("routes video requests to the real API provider video action", async () => {
    const video = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderVideo: {
        ok: true,
        providerId: "memefast-api",
        model: "sora-2",
        endpoint: "https://proxy.example.test/v1/videos",
        videos: [{ url: "https://cdn.example.test/angel.mp4" }],
      },
      events: [{ title: "视频生成完成", body: "https://cdn.example.test/angel.mp4" }],
    }));
    const image = vi.fn(async () => result("image"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          image,
          text,
          video,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/视频 电影感导演工作台 5 秒",
      surface: "workbench",
    });

    expect(text).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    expect(video).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_VIDEO,
        prompt: "电影感导演工作台 5 秒",
      }),
    );
    expect(response.apiProviderVideo).toMatchObject({
      ok: true,
      videos: [{ url: "https://cdn.example.test/angel.mp4" }],
    });
    expect(response.events.map((event) => event.title)).toEqual(["视频生成完成"]);
  });

  it("keeps image-generation questions in dynamic chat instead of treating them as image jobs", async () => {
    const image = vi.fn(async () => result("image"));
    const text = vi.fn(async () => result("text"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        apiProviders: {
          image,
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "怎么生成图片？",
      surface: "workbench",
    });

    expect(image).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "怎么生成图片？",
      }),
    );
  });

  it("keeps mixed time and web research questions with production words on the text model path", async () => {
    const productionStart = vi.fn(async () => result("production"));
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "deepseek-v3.2",
        output: "现在是本地时间；我会联网查最近适合分镜图的图片模型。",
      },
      events: [{ title: "模型调用完成" }],
    }));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        production: {
          start: productionStart,
        },
        apiProviders: {
          text,
        },
      },
    });

    const response = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "这是什么时间了？你去互联网看看最近生成图片分镜图哪个模型最厉害",
      surface: "workbench",
    });

    expect(productionStart).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt: "这是什么时间了？你去互联网看看最近生成图片分镜图哪个模型最厉害",
      }),
    );
    expect(response.apiProviderRun).toMatchObject({
      ok: true,
      output: expect.stringContaining("联网查"),
    });
  });

  it("routes expanded slash commands to real desktop and CLI capabilities", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const accept = vi.fn(async () => result("accept"));
    const publish = vi.fn(async () => result("publish"));
    const skillClassificationSave = vi.fn(async () => result("skill-classification"));
    const skillEnablementSet = vi.fn(async () => result("skill-enablement"));
    const skillDelete = vi.fn(async () => result("skill-delete"));
    const skillCategoryCreate = vi.fn(async () => result("skill-category"));
    const skillTagCreate = vi.fn(async () => result("skill-tag"));
    const skillProposeFromExperience = vi.fn(async () => result("skill-propose"));
    const skillProposalAccept = vi.fn(async () => result("skill-accept"));
    const skillProposalApply = vi.fn(async () => result("skill-apply"));
    const soulList = vi.fn(async () => result("soul-list"));
    const soulExplain = vi.fn(async () => result("soul-explain"));
    const soulAccept = vi.fn(async () => result("soul-accept"));
    const soulReject = vi.fn(async () => result("soul-reject"));
    const soulView = vi.fn(async () => result("soul-view"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
        experience: {
          accept,
        },
        knowledge: {
          publish,
        },
        skills: {
          classificationSave: skillClassificationSave,
          enablementSet: skillEnablementSet,
          delete: skillDelete,
          categoryCreate: skillCategoryCreate,
          tagCreate: skillTagCreate,
          proposeFromExperience: skillProposeFromExperience,
          proposalAccept: skillProposalAccept,
          proposalApply: skillProposalApply,
        },
        soul: {
          list: soulList,
          explain: soulExplain,
          accept: soulAccept,
          reject: soulReject,
          view: soulView,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具 启用 external-cli",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具 禁用 external-cli",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具 说明 external-cli",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 应用 session-1 proposal-1 ship it",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 新建分类 导演制作",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 新建标签 镜头语言",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 分类 skill.backend-snapshot director-production shot-language,lighting",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 关闭 skill.external 暂停外部来源",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 开启 skill.external",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 删除 skill.external 已废弃",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 从经验 experience-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 接受 skill-proposal-42 keep",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 应用 skill-proposal-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/审查 接受 proposal-2 keep lesson",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 审计 run-1",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 协作 run-1",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 重试 run-1 assignment-1",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 批准 run-1 assignment-2",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 批准全部 run-1",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/运行 切换 run-1 assignment-1 adapter-2",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/知识 说明 pack-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/经验 接受 candidate-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/知识 发布 pack-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/灵魂 候选",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/灵魂 说明 soul-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/灵魂 接受 soul-42",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/灵魂 拒绝 soul-43",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/灵魂",
      surface: "workbench",
    });

    expect(commandRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commandId: "adapter.enable", args: { adapterId: "external-cli" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        commandId: "adapter.disable",
        args: { adapterId: "external-cli" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        commandId: "adapter.explain",
        args: { adapterId: "external-cli" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        commandId: "task.proposal-apply",
        args: { sessionId: "session-1", proposalId: "proposal-1", note: "ship it" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        commandId: "traceProposal.accept",
        args: { proposalId: "proposal-2", note: "keep lesson" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ commandId: "run.audit", args: { runId: "run-1" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      7,
      expect.objectContaining({ commandId: "run.delegations", args: { runId: "run-1" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      8,
      expect.objectContaining({
        commandId: "run.retry",
        args: { runId: "run-1", assignmentId: "assignment-1" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      9,
      expect.objectContaining({
        commandId: "run.approve",
        args: { runId: "run-1", assignmentId: "assignment-2" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      10,
      expect.objectContaining({
        commandId: "run.approvePending",
        args: { runId: "run-1" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      11,
      expect.objectContaining({
        commandId: "run.reroute",
        args: { runId: "run-1", assignmentId: "assignment-1", adapterId: "adapter-2" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      12,
      expect.objectContaining({ commandId: "knowledge.explain", args: { packId: "pack-42" } }),
      expect.any(Function),
    );
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
        candidateId: "candidate-42",
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
        packId: "pack-42",
      }),
    );
    expect(skillCategoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE,
        name: "导演制作",
      }),
    );
    expect(skillTagCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_TAG_CREATE,
        name: "镜头语言",
      }),
    );
    expect(skillClassificationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
        skillId: "skill.backend-snapshot",
        categoryId: "director-production",
        tagIds: ["shot-language", "lighting"],
      }),
    );
    expect(skillEnablementSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
        skillId: "skill.external",
        enabled: false,
        note: "暂停外部来源",
      }),
    );
    expect(skillEnablementSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_ENABLEMENT_SET,
        skillId: "skill.external",
        enabled: true,
      }),
    );
    expect(skillDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_DELETE,
        skillId: "skill.external",
        note: "已废弃",
      }),
    );
    expect(skillProposeFromExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
        candidateId: "experience-42",
      }),
    );
    expect(skillProposalAccept).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
        proposalId: "skill-proposal-42",
        note: "keep",
      }),
    );
    expect(skillProposalApply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
        proposalId: "skill-proposal-42",
      }),
    );
    expect(soulList).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SOUL_LIST,
      }),
    );
    expect(soulExplain).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SOUL_EXPLAIN,
        candidateId: "soul-42",
      }),
    );
    expect(soulAccept).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SOUL_ACCEPT,
        candidateId: "soul-42",
      }),
    );
    expect(soulReject).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SOUL_REJECT,
        candidateId: "soul-43",
      }),
    );
    expect(soulView).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SOUL_VIEW,
      }),
    );
  });

  it("routes shared desktop slash commands before local group help fallbacks", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const apiProviderSet = vi.fn(async () => result("provider-set"));
    const knowledgeRecallPreview = vi.fn(async () => result("knowledge-recall"));
    const skillClassificationSave = vi.fn(async () => result("skill-classification"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
        apiProviders: {
          set: apiProviderSet,
        },
        knowledge: {
          recallPreview: knowledgeRecallPreview,
        },
        skills: {
          classificationSave: skillClassificationSave,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/知识 对比 left-pack right-pack",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/知识 回滚 pack-42 3",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/记忆 召回 project=short-drama",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/技能 标签 skill-1 cinematic,comfyui",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/设置 文本模型 memefast-api gpt-5.5",
      surface: "workbench",
    });

    expect(commandRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        commandId: "knowledge.diff",
        args: { leftId: "left-pack", rightId: "right-pack" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        commandId: "knowledge.rollback",
        args: { packId: "pack-42", version: "3" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        commandId: "memory.recallPreview",
        args: { query: "project=short-drama" },
      }),
      expect.any(Function),
    );
    expect(skillClassificationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
        skillId: "skill-1",
        tagIds: ["cinematic", "comfyui"],
      }),
    );
    expect(apiProviderSet).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_SET,
        providerId: "memefast-api",
        key: "defaultTextModel",
        value: "gpt-5.5",
      }),
    );
    expect(knowledgeRecallPreview).not.toHaveBeenCalled();
  });

  it("routes non-workbench panel detail prompts through real CLI commands", async () => {
    const commandRun = vi.fn(async () => result("command"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        command: {
          run: commandRun,
        },
      },
    });

    const prompts = [
      "/技能 解释 session-1 proposal-1",
      "/技能 预览 session-1 proposal-1",
      "/审查 状态",
      "/审查 解释 proposal-2",
      "/审查 审查 proposal-2",
      "/审查 预览 proposal-2",
      "/审查 拒绝 proposal-2 stale",
      "/审查 重放 proposal-2 worker-7",
      "/运行 状态 run-1",
      "/运行 协作 run-1",
      "/运行 报告 run-1",
      "/运行 解释 run-1",
    ];

    for (const prompt of prompts) {
      await facade.invoke({
        type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
        prompt,
        surface: "workbench",
      });
    }

    expect(commandRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        commandId: "task.proposal-explain",
        args: { sessionId: "session-1", proposalId: "proposal-1" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        commandId: "task.proposal-preview",
        args: { sessionId: "session-1", proposalId: "proposal-1" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ commandId: "traceProposal.status", args: {} }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        commandId: "traceProposal.explain",
        args: { proposalId: "proposal-2" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        commandId: "traceProposal.review",
        args: { proposalId: "proposal-2" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        commandId: "traceProposal.preview",
        args: { proposalId: "proposal-2" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      7,
      expect.objectContaining({
        commandId: "traceProposal.reject",
        args: { proposalId: "proposal-2", note: "stale" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      8,
      expect.objectContaining({
        commandId: "traceProposal.replay",
        args: { proposalId: "proposal-2", workerId: "worker-7" },
      }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      9,
      expect.objectContaining({ commandId: "run.status", args: { runId: "run-1" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      10,
      expect.objectContaining({ commandId: "run.delegations", args: { runId: "run-1" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      11,
      expect.objectContaining({ commandId: "run.report", args: { runId: "run-1" } }),
      expect.any(Function),
    );
    expect(commandRun).toHaveBeenNthCalledWith(
      12,
      expect.objectContaining({ commandId: "run.explain", args: { runId: "run-1" } }),
      expect.any(Function),
    );
  });

  it("rejects composer execution when the surface is not the workbench", async () => {
    const commandRun = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/tmp/workspace" },
      events: [],
    }));
    const learnUrl = vi.fn(async () => result("learn-url"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => ({
          snapshot: { candidate: { id: null, status: "none" }, knowledge: { publishedCount: 0 } },
          events: [],
        })),
        command: {
          run: commandRun,
        },
        experience: {
          learnUrl,
        },
      },
    });

    const toolsResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/工具",
      surface: "tools",
    });
    const experienceResponse = await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "https://example.com/lesson",
      surface: "experience",
    });

    expect(commandRun).not.toHaveBeenCalled();
    expect(learnUrl).not.toHaveBeenCalled();
    for (const response of [toolsResponse, experienceResponse]) {
      expect(response.events[0]).toMatchObject({
        title: "Desktop surface state",
        body: expect.stringContaining("Desktop surface state:"),
      });
      expect(response.events[0].body).toContain("status: blocked");
      expect(response.events[0].body).not.toContain("请回到工作台");
    }
  });

  it("fails closed when a handler has not been wired", async () => {
    const facade = createDirectorDesktopBridgeFacade({ handlers: {} });

    await expect(facade.invoke({ type: DESKTOP_ACTIONS.EXPERIENCE_LIST })).rejects.toThrow(
      /No desktop bridge handler/i,
    );
  });

  it("routes review slash prompts into run-output experience actions", async () => {
    const createFromRunReport = vi.fn(async () => result("run-lesson"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        experience: {
          createFromRunReport,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/审查 记录教训 run-1",
      surface: "workbench",
    });

    expect(createFromRunReport).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runId: "run-1",
      intent: "failure-lesson",
      sourceAction: expect.objectContaining({
        prompt: "/审查 记录教训 run-1",
      }),
      turnId: expect.any(String),
      activeEvidenceFrame: null,
    });
  });

  it("routes reflection slash prompts into real run reflection actions", async () => {
    const reflect = vi.fn(async () => result("reflect"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        run: {
          reflect,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/复盘 run-1",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/反思 run-2",
      surface: "workbench",
    });

    expect(reflect).toHaveBeenNthCalledWith(1, {
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-1",
      sourceAction: expect.objectContaining({
        prompt: "/复盘 run-1",
      }),
      turnId: expect.any(String),
      activeEvidenceFrame: null,
    });
    expect(reflect).toHaveBeenNthCalledWith(2, {
      type: DESKTOP_ACTIONS.RUN_REFLECT,
      runId: "run-2",
      sourceAction: expect.objectContaining({
        prompt: "/反思 run-2",
      }),
      turnId: expect.any(String),
      activeEvidenceFrame: null,
    });
  });

  it("routes heartbeat slash prompts into safe desktop heartbeat and switch actions", async () => {
    const status = vi.fn(async () => result("heartbeat"));
    const set = vi.fn(async () => result("settings"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        heartbeat: {
          status,
        },
        settings: {
          set,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/心跳 状态",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/心跳 开启",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/心跳 关闭",
      surface: "workbench",
    });

    expect(status).toHaveBeenCalledWith({
      type: DESKTOP_ACTIONS.HEARTBEAT_STATUS,
      sourceAction: expect.objectContaining({
        prompt: "/心跳 状态",
      }),
      turnId: expect.any(String),
      activeEvidenceFrame: null,
    });
    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: true,
      }),
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.SETTINGS_SET,
        parameterId: "feature:heartbeat.enabled",
        value: false,
      }),
    );
  });

  it("routes maintenance slash prompts into preview-first cleanup actions", async () => {
    const preview = vi.fn(async () => result("maintenance-preview"));
    const apply = vi.fn(async () => result("maintenance-apply"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        maintenance: {
          preview,
          apply,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/维护 日志保留 7 最低分 50",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/维护 执行 日志保留 7",
      surface: "workbench",
    });

    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
        logRetentionDays: 7,
        staleUnreviewedMinimumScore: 50,
      }),
    );
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.MAINTENANCE_APPLY,
        logRetentionDays: 7,
      }),
    );
  });

  it("routes weixin gateway slash prompts into service control actions", async () => {
    const weixinGatewayControl = vi.fn(async () => result("weixin-gateway"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        settings: {
          weixinGatewayControl,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/微信 状态",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/微信 启动",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "/微信 停止",
      surface: "workbench",
    });

    expect(weixinGatewayControl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
        operation: "status",
      }),
    );
    expect(weixinGatewayControl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
        operation: "start",
      }),
    );
    expect(weixinGatewayControl).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
        operation: "stop",
      }),
    );
  });

  it("keeps weixin article reading prompts out of gateway management", async () => {
    const text = vi.fn(async () => ({
      snapshot: { workspaceRoot: "/workspace" },
      apiProviderRun: {
        ok: true,
        providerId: "memefast-api",
        model: "deepseek-v3.2",
        output: "没读到可信正文。",
      },
      events: [{ title: "模型调用完成", body: "没读到可信正文。" }],
    }));
    const weixinGatewayControl = vi.fn(async () => result("weixin-gateway"));
    const facade = createDirectorDesktopBridgeFacade({
      handlers: {
        snapshot: vi.fn(async () => snapshotResult()),
        settings: {
          weixinGatewayControl,
        },
        apiProviders: {
          text,
        },
      },
    });

    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt:
        "打开这个微信公众号文章，直接读取正文并告诉我讲了什么：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      surface: "workbench",
    });
    await facade.invoke({
      type: DESKTOP_ACTIONS.COMPOSER_SUBMIT,
      prompt: "查看微信网关状态",
      surface: "workbench",
    });

    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.API_PROVIDER_TEXT,
        prompt:
          "打开这个微信公众号文章，直接读取正文并告诉我讲了什么：https://mp.weixin.qq.com/s/yvSFP83rP6O1NndGBb7UAA",
      }),
    );
    expect(weixinGatewayControl).toHaveBeenCalledTimes(1);
    expect(weixinGatewayControl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
        operation: "status",
      }),
    );
  });
});

function result(label) {
  return {
    snapshot: {
      activePanel: null,
      health: { label, state: "ok" },
      candidate: { count: 0, id: null, status: "none" },
      knowledge: { count: 0 },
      recall: { state: "miss", copy: "" },
    },
    events: [],
  };
}

function snapshotResult(overrides = {}) {
  return {
    snapshot: {
      candidate: { id: null, status: "none", ...(overrides.candidate ?? {}) },
      knowledge: {
        publishedCount: 0,
        candidateId: null,
        candidateStatus: "none",
        ...(overrides.knowledge ?? {}),
      },
      assets: overrides.assets ?? {},
    },
    events: [],
  };
}
