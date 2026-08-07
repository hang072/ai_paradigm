import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
} from 'antd';
import { TasksApi } from '../../api/tasks';
import { TemplatesApi } from '../../api/templates';
import type { WorkflowTemplate } from '../../types/template';
import type { TaskType } from '../../types/task';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (threadId: string) => void;
  defaultTemplateId?: string;
}

export function NewTaskModal({ open, onClose, onCreated, defaultTemplateId }: Props) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      TemplatesApi.list().then(setTemplates);
      form.setFieldsValue({
        task_type: '幻灯',
        template_id: defaultTemplateId ?? 'tpl-full',
        title: '',
        brief: '',
      });
    }
  }, [open, defaultTemplateId, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const snap = await TasksApi.start({
        brief: values.brief,
        task_type: values.task_type as TaskType,
        title: values.title,
        template_id: values.template_id,
      });
      message.success('任务已启动');
      onCreated(snap.thread_id);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="新建任务"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="启动"
      confirmLoading={submitting}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="任务类型" name="task_type" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio.Button value="幻灯">🎯 幻灯片</Radio.Button>
            <Radio.Button value="文章">📄 文章</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="工作流模板" name="template_id" rules={[{ required: true }]}>
          <Select
            options={templates.map((t) => ({
              value: t.id,
              label: (
                <Space>
                  <span>{t.name}</span>
                  <span style={{ color: '#6b7a90', fontSize: 12 }}>· {t.description}</span>
                </Space>
              ),
            }))}
          />
        </Form.Item>
        <Form.Item label="标题(可选)" name="title">
          <Input placeholder="留空则自动从 brief 生成" />
        </Form.Item>
        <Form.Item
          label="Brief · 请描述具体需求、接受标准…"
          name="brief"
          rules={[{ required: true, message: '请填写任务 brief' }]}
        >
          <Input.TextArea
            rows={6}
            placeholder="例:为心内科医生做一份 40 分钟的心脑血管疾病诊疗新进展讲课,受众为主治医师。"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
