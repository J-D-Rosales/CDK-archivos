import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';

export class ApiStudentsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Parámetros por contexto ----
    const imageUri: string = this.node.tryGetContext('imageUri');
    const containerPort: number = Number(this.node.tryGetContext('containerPort') ?? 8000);
    const labRoleArn: string = this.node.tryGetContext('labRoleArn');
    const desiredCount: number = Number(this.node.tryGetContext('desiredCount') ?? 1);
    const cpu: number = Number(this.node.tryGetContext('cpu') ?? 256);
    const memoryMiB: number = Number(this.node.tryGetContext('memoryMiB') ?? 512);
    const useDefaultVpc: boolean = (this.node.tryGetContext('useDefaultVpc') ?? 'true') === true || this.node.tryGetContext('useDefaultVpc') === 'true';

    if (!imageUri || !labRoleArn) {
      throw new Error('Faltan context vars: imageUri y labRoleArn son requeridos.');
    }

    // ---- VPC ----
    let vpc: ec2.IVpc;
    if (useDefaultVpc) {
      // Usa la Default VPC (no requiere bootstrap)
      vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    } else {
      // Alternativa: importar por IDs si prefieres (comenta el bloque anterior y descomenta esto):
      /*
      const vpcId = this.node.tryGetContext('vpcId'); // vpc-xxxx
      const publicSubnetIds: string[] = (this.node.tryGetContext('publicSubnetIds') || '').split(',');
      vpc = ec2.Vpc.fromVpcAttributes(this, 'ImportedVpc', {
        vpcId,
        availabilityZones: cdk.Stack.of(this).availabilityZones,
        publicSubnetIds,
      });
      */
      throw new Error('useDefaultVpc=false requiere pasar vpcId y publicSubnetIds en el context.');
    }

    // ---- Roles (reutiliza LabRole para Task y Execution) ----
    const labRole = iam.Role.fromRoleArn(this, 'LabRole', labRoleArn, { mutable: false });

    // ---- ECS Cluster ----
    const cluster = new ecs.Cluster(this, 'ApiStudentsCluster', {
      vpc,
      clusterName: 'api-students-cluster',
      containerInsights: true,
    });

    // ---- Fargate Service con ALB (patrón) ----
    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ApiStudentsService', {
      cluster,
      publicLoadBalancer: true,
      desiredCount,
      cpu,
      memoryLimitMiB: memoryMiB,
      listenerPort: 80,
      redirectHTTP: false,
      assignPublicIp: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(imageUri),
        containerPort,
        containerName: 'api-students',
        enableLogging: true,
        executionRole: labRole,
        taskRole: labRole,
        environment: {
          // agrega aquí variables de entorno si las necesitas
        },
      },
    });

    // Health check del Target Group
    fargateService.targetGroup.configureHealthCheck({
      path: '/students',
      healthyHttpCodes: '200-499',
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // Security Group: permitir HTTP desde Internet
    fargateService.listener.connections.allowDefaultPortFromAnyIpv4('Allow HTTP from anywhere');

    // AutoScaling opcional (puedes comentar si no lo usas)
    const scaling = fargateService.service.autoScaleTaskCount({ minCapacity: desiredCount, maxCapacity: Math.max(desiredCount, 3) });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    // Retentions/Logs (por defecto ECS crea logs en CloudWatch /ecs/api-students/...)
    // Si quieres controlar la retención explícitamente, crea un LogGroup y pásalo al container.

    // Outputs
    new CfnOutput(this, 'LoadBalancerDNS', { value: fargateService.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, 'ServiceName', { value: fargateService.service.serviceName });
    new CfnOutput(this, 'TargetGroupName', { value: fargateService.targetGroup.targetGroupName });
  }
}
