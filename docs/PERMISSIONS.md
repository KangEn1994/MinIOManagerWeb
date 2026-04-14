# 权限模板说明

后台只提供四种桶级模板：

- `No Access`
- `Read Only`
- `Read / Write`
- `Read / Write / Delete`

策略命名规则：

- `mw_bucket_<bucket>_ro`
- `mw_bucket_<bucket>_rw`
- `mw_bucket_<bucket>_rwd`

设计目的：

- 减少手写 JSON 策略
- 保持用户和分组授权一致
- 让后台只管理自己创建的策略，避免误伤现有 MinIO 策略
